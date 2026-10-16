"""Protected local release fixtures. Never invokes the real Supabase CLI."""
import importlib.util
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('readback', ROOT / '.github/scripts/edge-source-readback.py')
readback = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readback)


class WorkflowContract(unittest.TestCase):
    def test_no_false_live_tag_after_an_unverified_upload(self):
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        marker = '- name: Verify deployed source'
        self.assertIn(marker, workflow, 'CLI exit zero must not certify deployed source')
        verification = workflow.split(marker, 1)[1].split('- name: Record deployed commit', 1)[0]
        self.assertIn('python3 .github/scripts/edge-source-readback.py', verification)
        self.assertIn('--expected-commit', verification)
        self.assertIn('--functions affected.txt', verification)
        self.assertNotIn('continue-on-error', verification)
        self.assertNotIn('|| true', verification)
        tag = workflow.split('- name: Record deployed commit', 1)[1]
        self.assertIn('success()', tag)
        self.assertIn("steps.readback.outcome == 'success'", tag)

    def test_preserves_retirement_and_no_effectful_readback_commands(self):
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        self.assertLess(workflow.index('- name: Delete retired functions'), workflow.index('- name: Deploy affected functions'))
        self.assertIn("if: always() && steps.affected.outcome == 'success' && steps.retired.outcome == 'success' && steps.retired.outputs.count != '0'", workflow)
        self.assertIn('supabase functions delete "$fn" --project-ref "$ref" --yes', workflow)
        self.assertIn('supabase functions deploy "$fn" --project-ref "$ref"', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn('version: 2.116.0', workflow)
        self.assertNotIn('--no-verify-jwt', workflow)
        affected = workflow.split('- name: Resolve affected functions', 1)[1].split('- name: Setup Supabase CLI', 1)[0]
        self.assertNotIn('if:', affected, 'An empty selected set must still produce count=0')
        self.assertIn('edge-affected.py < changed.txt', affected)
        self.assertIn('set -euo pipefail', affected, 'Rejected local configuration must stop selection before success/count outputs')
        for name in ['Setup Supabase CLI', 'Preflight — the provider accepts the credential',
                     'Delete retired functions at the provider', 'Deploy affected functions', 'Verify deployed source']:
            step = workflow.split(f'- name: {name}', 1)[1].split('\n      - name:', 1)[0]
            self.assertIn("steps.affected.outcome == 'success'", step.split('if:', 1)[1].splitlines()[0],
                          f'Every provider boundary must require successful local target validation: {name}')


class ReleaseFixtures(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='paige-edge-fixture-')
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.files = {
            'supabase/config.toml': 'project_id = "test-project"\n[functions.crm-command]\nverify_jwt = false\n',
            'supabase/functions/paige-ai-chat/index.ts': 'import { task } from "../_shared/task.ts";\nexport const outcome = task;\n',
            'supabase/functions/_shared/task.ts': 'export { owner as task } from "./authority.ts";\n',
            'supabase/functions/_shared/authority.ts': 'export const owner = "fixture owner";\n',
            'supabase/functions/crm-command/index.ts': 'export const crm = "canonical fixture";\n',
        }
        for name, content in self.files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Protected release fixture')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.names = ['paige-ai-chat', 'crm-command']
        self.rows = [self.row(name) for name in self.names]
        self.calls = []
        self.downloads = []
        self.mode = 'good'
        self.metadata_calls = 0
        self.sleeps = []

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def row(self, name):
        return {'id': f'test-function-{name}', 'slug': name, 'status': 'ACTIVE', 'version': 7,
                'verify_jwt': name != 'crm-command', 'entrypoint_path': f'file:///app/supabase/functions/{name}/index.ts',
                'ezbr_sha256': 'a' * 64}

    def runner(self, args, directory, timeout):
        self.assertEqual(args[-2:], ['--project-ref', 'test-project'])
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 60)
        self.assertFalse(directory.is_relative_to(self.repo), 'CLI download must never touch checkout')
        self.calls.append(args)
        if args[:2] == ['functions', 'list']:
            self.assertEqual(args[2:4], ['-o', 'json'])
            self.metadata_calls += 1
            rows = json.loads(json.dumps(self.rows))
            if self.mode == 'invalid-list':
                return 'not JSON'
            if self.mode == 'list-failed':
                raise readback.ReadbackError('cli_readback_failed')
            if self.mode == 'final-list-failed' and self.metadata_calls % 2 == 0:
                raise readback.ReadbackError('cli_readback_failed')
            if self.mode == 'changing-version':
                for row in rows:
                    row['version'] = self.metadata_calls
            return json.dumps(rows)
        self.assertEqual(args[:2], ['functions', 'download'])
        self.assertEqual(args[3], '--use-api')
        name = args[2]
        self.downloads.append(name)
        if self.mode == 'download-failed' and name == 'paige-ai-chat':
            raise readback.ReadbackError('cli_readback_failed')
        files = {p: c for p, c in self.files.items() if p.startswith(f'supabase/functions/{name}/') or
                 (name == 'paige-ai-chat' and p.startswith('supabase/functions/_shared/'))}
        if self.mode == 'missing-dependency':
            files.pop('supabase/functions/_shared/authority.ts', None)
        if self.mode == 'pruned-type-only':
            for path in ['supabase/functions/_shared/types-only.ts', 'supabase/functions/_shared/types-child.ts']:
                files.pop(path, None)
        if self.mode == 'empty-download':
            files = {}
        if self.mode == 'wrong-entry-bytes' and name == 'paige-ai-chat':
            files['supabase/functions/paige-ai-chat/index.ts'] = 'export const wrong = true;\n'
        if self.mode == 'stale-chat' and name == 'paige-ai-chat':
            files['supabase/functions/_shared/authority.ts'] = 'export const owner = "old fixture";\n'
        if self.mode == 'whitespace-change' and name == 'paige-ai-chat':
            files['supabase/functions/_shared/authority.ts'] += '\n'
        if self.mode == 'eventually-current' and name == 'paige-ai-chat' and self.downloads.count(name) == 1:
            files['supabase/functions/_shared/authority.ts'] = 'export const owner = "old fixture";\n'
        if self.mode == 'extra-untracked':
            files[f'supabase/functions/{name}/untracked.ts'] = 'export const unexpected = true;\n'
        if self.mode == 'tracked-extra':
            files['supabase/functions/optional/unused.ts'] = self.files['supabase/functions/optional/unused.ts']
        for path, content in files.items():
            dest = directory / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            if self.mode == 'crlf-no-terminal':
                dest.write_bytes(content.removesuffix('\n').replace('\n', '\r\n').encode())
            else:
                dest.write_text(content, encoding='utf-8')
        if self.mode == 'symlink':
            try:
                (directory / 'supabase/functions/escape.ts').symlink_to(self.repo / 'supabase/config.toml')
            except OSError:
                self.skipTest('Host does not permit fixture symlinks')
        return 'download complete'

    def verify(self):
        return readback.verify(self.repo, self.commit, self.names, self.runner, self.sleeps.append)

    def assert_failed(self, report, reason, function='paige-ai-chat'):
        self.assertFalse(report['all_pass'])
        row = next(r for r in report['functions'] if r['function'] == function)
        self.assertEqual(row['status'], 'FAIL')
        self.assertEqual(row['reason'], reason)

    def test_unchanged_valid_source_and_same_version_pass(self):
        report = self.verify()
        self.assertTrue(report['all_pass'])
        self.assertEqual([r['version'] for r in report['functions']], [7, 7])
        self.assertEqual([len(r['files']) for r in report['functions']], [3, 1])
        self.assertEqual(self.sleeps, [])

    def test_stale_chat_does_not_erase_successful_crm_or_certify_release(self):
        self.mode = 'stale-chat'
        report = self.verify()
        self.assert_failed(report, 'deployed_source_mismatch')
        self.assertEqual(report['functions'][1]['status'], 'PASS')
        self.assertEqual(self.downloads.count('crm-command'), 1)
        self.assertEqual(self.downloads.count('paige-ai-chat'), 3)
        self.assertEqual(self.sleeps, [5, 5])

    def test_nested_missing_dependency_is_not_full_coverage(self):
        self.mode = 'missing-dependency'
        self.assert_failed(self.verify(), 'download_missing_dependency')

    def test_zero_exit_empty_download_cannot_pass(self):
        self.mode = 'empty-download'
        self.assert_failed(self.verify(), 'download_missing_source')

    def test_download_failure_is_not_success(self):
        self.mode = 'download-failed'
        self.assert_failed(self.verify(), 'cli_readback_failed')

    def test_failed_final_metadata_observation_cannot_keep_an_old_pass(self):
        self.mode = 'final-list-failed'
        report = self.verify()
        self.assert_failed(report, 'cli_readback_failed')
        self.assertEqual(report['functions'][1]['status'], 'FAIL')

    def test_wrong_jwt_fails_before_download_without_changing_configuration(self):
        self.rows[0]['verify_jwt'] = False
        self.assert_failed(self.verify(), 'jwt_configuration_mismatch')
        self.assertNotIn('paige-ai-chat', self.downloads)

    def test_wrong_entrypoint_fails_even_if_basename_matches(self):
        self.rows[0]['entrypoint_path'] = 'file:///different/functions/paige-ai-chat/index.ts'
        self.assert_failed(self.verify(), 'entrypoint_mismatch')

    def test_correct_entrypoint_metadata_cannot_hide_wrong_entry_bytes(self):
        self.mode = 'wrong-entry-bytes'
        self.assert_failed(self.verify(), 'deployed_source_mismatch')

    def test_inactive_function_is_not_live(self):
        self.rows[0]['status'] = 'DEPLOYING'
        self.assert_failed(self.verify(), 'function_not_active')

    def test_missing_metadata_is_not_success(self):
        self.rows.pop(0)
        self.assert_failed(self.verify(), 'missing_or_duplicate_metadata')

    def test_duplicate_metadata_is_not_accepted(self):
        self.rows.append(self.rows[0])
        self.assert_failed(self.verify(), 'missing_or_duplicate_metadata')

    def test_invalid_metadata_is_not_an_empty_success(self):
        self.mode = 'invalid-list'
        self.assert_failed(self.verify(), 'invalid_metadata_response')

    def test_untrusted_archive_digest_is_not_published(self):
        self.rows[0]['ezbr_sha256'] = 'unexpected raw provider payload'
        report = self.verify()
        self.assert_failed(report, 'invalid_archive_identity')
        self.assertNotIn('unexpected raw provider payload', json.dumps(report))

    def test_version_change_during_download_requires_another_observation(self):
        self.mode = 'changing-version'
        self.assert_failed(self.verify(), 'deployment_changed_during_readback')

    def test_bounded_propagation_retry_recovers_and_keeps_successful_crm(self):
        self.mode = 'eventually-current'
        self.assertTrue(self.verify()['all_pass'])
        self.assertEqual(self.downloads.count('paige-ai-chat'), 2)
        self.assertEqual(self.downloads.count('crm-command'), 1)

    def test_crlf_and_single_terminal_newline_normalization(self):
        self.mode = 'crlf-no-terminal'
        self.assertTrue(self.verify()['all_pass'])

    def test_other_whitespace_is_not_normalized_away(self):
        self.mode = 'whitespace-change'
        self.assert_failed(self.verify(), 'deployed_source_mismatch')

    def test_extra_untracked_runtime_source_is_not_ignored(self):
        self.mode = 'extra-untracked'
        self.assert_failed(self.verify(), 'immutable_source_unavailable')

    def test_extra_tracked_source_is_checked_against_exact_commit(self):
        path = 'supabase/functions/optional/unused.ts'
        self.files[path] = 'export const optional = true;\n'
        (self.repo / path).parent.mkdir(parents=True)
        (self.repo / path).write_text(self.files[path], encoding='utf-8')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Known extra fixture')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.mode = 'tracked-extra'
        self.assertTrue(self.verify()['all_pass'])

    def test_symlink_cannot_read_checkout_or_escape_download(self):
        self.mode = 'symlink'
        self.assert_failed(self.verify(), 'unsafe_download_path')

    def test_changed_local_imported_source_cannot_redefine_expected_bytes(self):
        (self.repo / 'supabase/functions/_shared/authority.ts').write_text('changed local bytes\n')
        with self.assertRaisesRegex(readback.ReadbackError, 'checkout_differs_from_commit'):
            self.verify()
        self.assertEqual(self.calls, [])

    def test_wrong_or_ambiguous_commit_is_rejected(self):
        for commit in ['HEAD', '0' * 40]:
            with self.subTest(commit=commit), self.assertRaises(readback.ReadbackError):
                readback.verify(self.repo, commit, self.names, self.runner, self.sleeps.append)
        self.assertEqual(self.calls, [])

    def recommit(self):
        for path, content in self.files.items():
            destination = self.repo / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding='utf-8')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture configuration')
        self.commit = self.git('rev-parse', 'HEAD').strip()

    def test_current_custom_entrypoint_and_explicit_import_map_are_verified(self):
        config = self.files['supabase/config.toml']
        config += '[functions.paige-ai-chat]\nentrypoint = "./functions/paige-ai-chat/main.ts"\nimport_map = "./functions/paige-ai-chat/deno.json"\n'
        self.files['supabase/config.toml'] = config
        self.files['supabase/functions/paige-ai-chat/main.ts'] = self.files.pop('supabase/functions/paige-ai-chat/index.ts')
        self.files['supabase/functions/paige-ai-chat/deno.json'] = '{"imports":{"example":"npm:example@1"}}\n'
        (self.repo / 'supabase/functions/paige-ai-chat/index.ts').unlink()
        self.rows[0]['entrypoint_path'] = 'file:///app/supabase/functions/paige-ai-chat/main.ts'
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/paige-ai-chat/deno.json'
        self.recommit()
        self.assertTrue(self.verify()['all_pass'])
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/different/deno.json'
        self.assert_failed(self.verify(), 'import_map_mismatch')

    def test_new_eligible_function_uses_the_same_shared_verifier(self):
        name = 'future-solo-command'
        self.files[f'supabase/functions/{name}/index.ts'] = 'export const future = true;\n'
        self.recommit()
        self.names.append(name)
        row = self.row(name)
        self.rows.append(row)
        self.assertTrue(self.verify()['all_pass'])

    def test_automatic_deno_config_is_included_in_verified_source(self):
        self.files['supabase/functions/paige-ai-chat/deno.json'] = '{}\n'
        self.recommit()
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/paige-ai-chat/deno.json'
        report = self.verify()
        self.assertTrue(report['all_pass'])
        self.assertIn('supabase/functions/paige-ai-chat/deno.json', report['functions'][0]['files'])

    def test_unexpected_remote_import_map_is_not_silently_ignored(self):
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/paige-ai-chat/deno.json'
        self.assert_failed(self.verify(), 'unexpected_import_map')

    def test_unproven_static_assets_are_not_a_false_full_coverage_pass(self):
        self.files['supabase/config.toml'] += '[functions.paige-ai-chat]\nstatic_files = ["./functions/paige-ai-chat/*.html"]\n'
        self.recommit()
        with self.assertRaisesRegex(readback.ReadbackError, 'unsupported_static_file_proof'):
            self.verify()

    def test_entrypoint_url_cannot_hide_traversal_or_remote_origin(self):
        expected = 'supabase/functions/paige-ai-chat/index.ts'
        for path in ['https://example.invalid/' + expected, 'file://remote/' + expected,
                     'file:///app/%2e%2e/' + expected, 'file:///app/' + expected + '?wrong=1']:
            with self.subTest(path=path):
                self.assertFalse(readback.entrypoint_matches(path, expected))

    def test_local_alias_cannot_evade_the_existing_relative_import_closure(self):
        self.files['supabase/config.toml'] += '[functions.paige-ai-chat]\nimport_map = "./functions/paige-ai-chat/deno.json"\n'
        self.files['supabase/functions/paige-ai-chat/deno.json'] = '{"imports":{"hidden":"../_shared/authority.ts"}}\n'
        self.recommit()
        with self.assertRaisesRegex(readback.ReadbackError, 'unsupported_local_import_alias'):
            self.verify()
        self.assertEqual(self.calls, [])

    def test_changed_previously_verified_function_is_downloaded_again(self):
        self.mode = 'eventually-current'
        runner = self.runner
        def change_between_attempts(args, directory, timeout):
            if args[:2] == ['functions', 'list'] and self.metadata_calls == 2:
                self.rows[1]['version'] = 8
            return runner(args, directory, timeout)
        report = readback.verify(self.repo, self.commit, self.names, change_between_attempts, self.sleeps.append)
        self.assertTrue(report['all_pass'])
        self.assertEqual(self.downloads.count('crm-command'), 2)
        self.assertEqual(report['functions'][1]['version'], 8)

    def test_invalid_or_empty_selected_set_cannot_produce_vacuous_pass(self):
        for names in [[], ['../escape'], ['paige-ai-chat', 'paige-ai-chat']]:
            with self.subTest(names=names), self.assertRaisesRegex(readback.ReadbackError, 'invalid_selected_functions'):
                readback.verify(self.repo, self.commit, names, self.runner, self.sleeps.append)

    def test_actual_cli_adapter_captures_failure_and_never_forwards_secrets(self):
        error = subprocess.CalledProcessError(1, ['supabase'], output='test-secret-body', stderr='test-secret-header')
        with patch.object(readback.subprocess, 'run', side_effect=error), self.assertRaisesRegex(readback.ReadbackError, '^cli_readback_failed$'):
            readback.cli(['functions', 'list'], self.repo, 1)

    def test_actual_cli_adapter_sets_isolated_workdir_and_captures_output(self):
        with patch.object(readback.subprocess, 'run', return_value=type('Result', (), {'stdout': '[]'})()) as run:
            self.assertEqual(readback.cli(['functions', 'list', '-o', 'json'], self.repo, 1), '[]')
        args, kwargs = run.call_args
        self.assertEqual(args[0][-2:], ['--workdir', str(self.repo)])
        self.assertTrue(kwargs['capture_output'])
        self.assertEqual(kwargs['cwd'], self.repo)
        self.assertNotIn('env', kwargs, 'Inherit the same existing release connection; never extract a token')

    def test_helper_main_returns_nonzero_and_writes_truthful_partial_report(self):
        selected = self.repo / 'affected.txt'
        selected.write_text('\n'.join(self.names) + '\n', encoding='utf-8')
        report = self.repo / 'result.json'
        self.mode = 'stale-chat'
        actual_verify = readback.verify
        def fixture_verify(repo, commit, names):
            return actual_verify(repo, commit, names, self.runner, self.sleeps.append)
        with patch.object(readback, 'verify', fixture_verify), contextlib.redirect_stdout(io.StringIO()) as output:
            code = readback.main(['--repo', str(self.repo), '--expected-commit', self.commit,
                                  '--functions', str(selected), '--report', str(report)])
        self.assertEqual(code, 1)
        self.assertIn('edge-live must not advance', output.getvalue())
        self.assert_failed(json.loads(report.read_text()), 'deployed_source_mismatch')

    def test_budget_exhaustion_never_calls_provider_or_sleeps(self):
        times = iter([0, readback.MAX_SECONDS + 1, readback.MAX_SECONDS + 1, readback.MAX_SECONDS + 1])
        report = readback.verify(self.repo, self.commit, self.names, self.runner, self.sleeps.append, lambda: next(times))
        self.assert_failed(report, 'verification_budget_exhausted')
        self.assertEqual(self.calls, [])
        self.assertEqual(self.sleeps, [])

    def run_actual_tag_guard(self, before):
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        record = workflow.split('- name: Record deployed commit', 1)[1]
        script = textwrap.dedent(record.split('run: |', 1)[1].split('git tag -f edge-live', 1)[0])
        script = script.replace('${{ steps.baseline.outputs.before }}', before)
        script = script.replace('${{ github.sha }}', self.commit)
        selected = self.repo / 'affected.txt'
        if not selected.exists():
            selected.write_text(''.join(name + '\n' for name in self.names), encoding='utf-8')
        executable = Path(os.sys.executable).as_posix()
        helper = (ROOT / '.github/scripts/edge-source-readback.py').as_posix()
        script = script.replace('python3 .github/scripts/edge-source-readback.py',
                                f'"{executable}" "{helper}" --repo .')
        bash = shutil.which('bash')
        if not bash and os.name == 'nt':
            bash = r'C:\Program Files\Git\bin\bash.exe'
        self.assertTrue(bash and Path(bash).is_file(), 'Actual tag-guard fixture requires existing Bash')
        return subprocess.run([bash, '-e', '-c', script], cwd=self.repo, capture_output=True, text=True, timeout=15)

    def select_as_workflow(self, before):
        """Run the incumbent graph, then the config supplement only if wired in the workflow."""
        spec = importlib.util.spec_from_file_location('fixture_edge_graph', ROOT / '.github/scripts/edge-affected.py')
        graph = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(graph)
        graph.REPO_ROOT = str(self.repo)
        graph.FUNCTIONS_DIR = str(self.repo / 'supabase/functions')
        changed = self.git('diff', '--name-only', before, self.commit, '--', 'supabase/functions/**')
        output = io.StringIO()
        with patch.object(graph.sys, 'stdin', io.StringIO(changed)), contextlib.redirect_stdout(output):
            self.assertEqual(graph.main(), 0)
        selected = self.repo / 'affected.txt'
        selected.write_text(output.getvalue(), encoding='utf-8')
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        affected = workflow.split('- name: Resolve affected functions', 1)[1].split('- name: Setup Supabase CLI', 1)[0]
        if '--select-config' in affected:
            with contextlib.redirect_stdout(io.StringIO()):
                code = readback.main(['--repo', str(self.repo), '--expected-commit', self.commit,
                                      '--baseline-commit', before, '--functions', str(selected), '--select-config'])
            if code:
                raise readback.ReadbackError('configuration_selection_refused')
        return selected.read_text(encoding='utf-8').splitlines()

    def test_manual_config_only_change_selects_the_exact_function(self):
        before = self.commit
        self.git('tag', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        self.assertEqual(self.select_as_workflow(before), ['crm-command'])

    def test_manual_config_and_unrelated_source_both_require_readback(self):
        before = self.commit
        self.git('tag', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        self.files['supabase/functions/paige-ai-chat/index.ts'] += '// unrelated source change\n'
        self.recommit()
        self.names = self.select_as_workflow(before)
        self.assertEqual(set(self.names), {'crm-command', 'paige-ai-chat'})
        self.assert_failed(self.verify(), 'jwt_configuration_mismatch', 'crm-command')
        self.rows[1]['verify_jwt'] = True
        self.assertTrue(self.verify()['all_pass'])

    def test_project_change_cannot_inherit_prior_project_certification(self):
        before = self.commit
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('test-project', 'different-test-project')
        self.recommit()
        with self.assertRaises(readback.ReadbackError):
            self.select_as_workflow(before)
        self.assertEqual(self.calls, [])

    def test_manual_tag_guard_refuses_omitted_config_change(self):
        before = self.commit
        self.git('tag', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        (self.repo / 'affected.txt').write_text('paige-ai-chat\n', encoding='utf-8')
        self.assertNotEqual(self.run_actual_tag_guard(before).returncode, 0,
                            'Manual baseline=edge-live must not hide a configuration-only gap')

    def test_explicit_type_only_parent_and_child_are_not_runtime_requirements(self):
        self.files['supabase/functions/paige-ai-chat/index.ts'] += (
            'import type { OnlyType } from "../_shared/types-only.ts";\n'
            'export type { OnlyType } from "../_shared/types-only.ts";\n')
        self.files['supabase/functions/_shared/types-only.ts'] = (
            'export type OnlyType = import("./types-child.ts").Child;\n')
        self.files['supabase/functions/_shared/types-child.ts'] = 'export type Child = string;\n'
        self.recommit()
        self.mode = 'pruned-type-only'
        report = self.verify()
        self.assertTrue(report['all_pass'], report)
        self.assertEqual(len(report['functions'][0]['files']), 3)

    def test_runtime_import_of_a_type_only_target_is_still_required(self):
        for statement in ['import "../_shared/types-only.ts";',
                          'import { runtime } from "../_shared/types-only.ts";',
                          'export { runtime } from "../_shared/types-only.ts";',
                          'const runtime = import("../_shared/types-only.ts");']:
            with self.subTest(statement=statement):
                self.files['supabase/functions/paige-ai-chat/index.ts'] = (
                    'import type { OnlyType } from "../_shared/types-only.ts";\n' + statement + '\n')
                self.files['supabase/functions/_shared/types-only.ts'] = 'export type OnlyType = string; export const runtime = true;\n'
                self.recommit()
                self.mode = 'pruned-type-only'
                self.assert_failed(self.verify(), 'download_missing_dependency')

    def test_mixed_type_and_value_import_remains_a_runtime_requirement(self):
        self.files['supabase/functions/paige-ai-chat/index.ts'] += (
            'import { type OnlyType, runtime } from "../_shared/types-only.ts";\n')
        self.files['supabase/functions/_shared/types-only.ts'] = 'export type OnlyType = string; export const runtime = true;\n'
        self.recommit()
        self.mode = 'pruned-type-only'
        self.assert_failed(self.verify(), 'download_missing_dependency')

    def test_comment_lookalike_is_conservative_not_an_ignored_runtime_edge(self):
        self.files['supabase/functions/paige-ai-chat/index.ts'] += (
            '// import type { OnlyType } from "../_shared/types-only.ts";\n'
            'const real = import("../_shared/types-only.ts");\n')
        self.files['supabase/functions/_shared/types-only.ts'] = 'export const runtime = true;\n'
        self.recommit()
        self.mode = 'pruned-type-only'
        self.assert_failed(self.verify(), 'download_missing_dependency')

    def test_config_comment_or_unrelated_settings_do_not_select_all_functions(self):
        before = self.commit
        self.files['supabase/config.toml'] += '# presentation-only comment\n[auth]\nenabled = true\n'
        self.recommit()
        self.assertEqual(self.select_as_workflow(before), [])

    def test_removed_explicit_options_restore_defaults_through_selected_readback(self):
        before = self.commit
        self.files['supabase/config.toml'] = 'project_id = "test-project"\n'
        self.recommit()
        self.names = self.select_as_workflow(before)
        self.assertEqual(self.names, ['crm-command'])
        self.assert_failed(self.verify(), 'jwt_configuration_mismatch', 'crm-command')
        self.rows[1]['verify_jwt'] = True
        self.assertTrue(self.verify()['all_pass'])

    def test_project_change_is_refused_by_actual_tag_guard(self):
        before = self.commit
        self.git('tag', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('test-project', 'different-test-project')
        self.recommit()
        self.assertNotEqual(self.run_actual_tag_guard(before).returncode, 0)

    def test_config_only_manual_recovery_passes_guard_after_exact_selection(self):
        before = self.commit
        self.git('tag', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        self.assertEqual(self.select_as_workflow(before), ['crm-command'])
        self.rows[1]['verify_jwt'] = True
        self.names = ['crm-command']
        self.assertTrue(self.verify()['all_pass'])
        self.assertEqual(self.run_actual_tag_guard(before).returncode, 0)

    def test_configuration_selection_cannot_reactivate_a_disabled_function(self):
        before = self.commit
        self.files['supabase/config.toml'] += 'enabled = false\n'
        self.recommit()
        with self.assertRaisesRegex(readback.ReadbackError, 'configuration_selection_refused'):
            self.select_as_workflow(before)
        self.assertEqual(self.calls, [])

    def prepare_retirement(self, configuration_change=None):
        source = 'supabase/functions/retired-fixture/index.ts'
        self.files[source] = 'export const retired = true;\n'
        self.recommit()
        before = self.commit
        self.files.pop(source)
        (self.repo / source).unlink()
        (self.repo / source).parent.rmdir()
        if configuration_change == 'project':
            self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('test-project', 'different-test-project')
        if configuration_change == 'disabled':
            self.files['supabase/config.toml'] += 'enabled = false\n'
        self.recommit()
        (self.repo / 'retired.txt').write_text('retired-fixture\n', encoding='utf-8', newline='\n')
        return before

    def run_actual_provider_step(self, name, selection='success', retirement='success', job_success=True):
        """Evaluate the actual bounded step condition and execute only its stubbed shell."""
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        step = workflow.split(f'- name: {name}', 1)[1].split('\n      - name:', 1)[0]
        condition = step.split('if:', 1)[1].splitlines()[0].strip()
        if not any(status in condition for status in ['always()', 'success()', 'failure()', 'cancelled()']):
            condition = f'({condition}) && success()'  # GitHub's implicit default status check.
        values = {'steps.affected.outcome': selection, 'steps.retired.outcome': retirement,
                  'steps.affected.outputs.count': '1', 'steps.retired.outputs.count': '1'}
        condition = condition.replace('always()', 'True').replace('success()', str(job_success))
        for key, value in values.items():
            condition = condition.replace(key, repr(value))
        condition = condition.replace('&&', ' and ').replace('||', ' or ')
        expression = ast.parse(condition, mode='eval')
        allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.NotEq, ast.Constant)
        self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(expression)), 'Unknown workflow expression must fail the fixture')
        eligible = eval(compile(expression, '<actual-step-condition>', 'eval'), {'__builtins__': {}})
        calls = self.repo / 'provider-calls.txt'
        if not eligible:
            return None, []
        script = textwrap.dedent(step.split('run: |', 1)[1])
        stub = 'supabase() { printf "%s\\n" "$*" >> provider-calls.txt; return 0; };\n'
        bash = shutil.which('bash') or (r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
        self.assertTrue(bash and Path(bash).is_file())
        result = subprocess.run([bash, '-e', '-c', stub + script], cwd=self.repo, capture_output=True, text=True,
                                timeout=15, env={**os.environ, 'SUPABASE_ACCESS_TOKEN': 'fixture-never-a-provider-token'})
        return result, calls.read_text(encoding='utf-8').splitlines() if calls.exists() else []

    def test_project_refusal_with_retirement_blocks_actual_delete_and_deploy(self):
        before = self.prepare_retirement('project')
        with self.assertRaisesRegex(readback.ReadbackError, 'configuration_selection_refused'):
            self.select_as_workflow(before)
        for name in ['Delete retired functions at the provider', 'Deploy affected functions']:
            result, calls = self.run_actual_provider_step(name, selection='failure', job_success=False)
            self.assertIsNone(result, f'Refused target configuration must suppress {name}; got {calls}')
            self.assertEqual(calls, [])

    def test_disabled_configuration_refusal_with_retirement_blocks_actual_delete(self):
        before = self.prepare_retirement('disabled')
        with self.assertRaisesRegex(readback.ReadbackError, 'configuration_selection_refused'):
            self.select_as_workflow(before)
        result, calls = self.run_actual_provider_step('Delete retired functions at the provider', selection='failure', job_success=False)
        self.assertIsNone(result, f'Refused configuration must suppress retirement; got {calls}')
        self.assertEqual(calls, [])

    def test_valid_retirement_still_runs_despite_later_ordinary_deploy_failure(self):
        before = self.prepare_retirement()
        self.select_as_workflow(before)
        result, calls = self.run_actual_provider_step('Delete retired functions at the provider', job_success=False)
        self.assertIsNotNone(result, 'A later deployment failure must not strand an authorized retirement')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['functions delete retired-fixture --project-ref test-project --yes'])

    def test_skipped_local_preflight_or_failed_retirement_computation_cannot_delete(self):
        self.prepare_retirement()
        for selection, retirement in [('skipped', 'success'), ('success', 'failure')]:
            result, calls = self.run_actual_provider_step('Delete retired functions at the provider',
                                                         selection=selection, retirement=retirement, job_success=False)
            self.assertIsNone(result, f'Unverified step outcomes must suppress deletion; got {calls}')
            self.assertEqual(calls, [])

    def test_prior_unverified_source_cannot_be_skipped_by_a_later_push(self):
        self.git('tag', 'edge-live', self.commit)
        self.files['supabase/functions/_shared/authority.ts'] += '// prior source not verified\n'
        self.recommit()
        result = self.run_actual_tag_guard(self.commit)
        self.assertNotEqual(result.returncode, 0, 'Later selected-set success cannot certify an older skipped source gap')

    def test_frontend_only_commits_do_not_hold_valid_source_tag(self):
        self.git('tag', 'edge-live', self.commit)
        (self.repo / 'presentation.txt').write_text('Unrelated presentation fixture\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Frontend fixture')
        before = self.git('rev-parse', 'HEAD').strip()
        self.commit = before
        self.assertEqual(self.run_actual_tag_guard(before).returncode, 0)

    def test_existing_manual_recovery_baseline_passes_tag_guard(self):
        self.git('tag', 'edge-live', self.commit)
        before = self.commit
        self.files['supabase/functions/_shared/authority.ts'] += '// recovery source\n'
        self.recommit()
        self.assertEqual(self.run_actual_tag_guard(before).returncode, 0)


if __name__ == '__main__':
    unittest.main()
