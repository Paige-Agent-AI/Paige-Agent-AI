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
    def workflow_condition(self, name, *, success=True, cancelled=False, **changes):
        """Evaluate the actual bounded Actions gate, including implicit success()."""
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        step = workflow.split('- name: ' + name, 1)[1].split('\n      - name:', 1)[0]
        expression = step.split('if:', 1)[1].splitlines()[0].strip().removeprefix('${{').removesuffix('}}').strip()
        if not success and not any(fn + '()' in expression for fn in ['success', 'always', 'cancelled', 'failure']):
            return False
        values = {'steps.affected.outcome': 'success', 'steps.affected.outputs.count': '2',
                  'steps.preflight.outcome': 'success', 'steps.retired.outputs.count': '0',
                  'steps.readback.outcome': 'success', **changes}
        for key, value in values.items():
            expression = expression.replace(key, repr(value))
        for key, value in [('!cancelled()', not cancelled), ('cancelled()', cancelled),
                           ('success()', success), ('always()', True)]:
            expression = expression.replace(key, repr(value))
        expression = expression.replace('&&', ' and ').replace('||', ' or ')
        tree = ast.parse(expression, mode='eval')
        allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not,
                   ast.Compare, ast.Eq, ast.NotEq, ast.Constant)
        self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(tree)), 'Only the declared literal gate grammar may run')
        return eval(compile(tree, '<actual-workflow-condition>', 'eval'), {'__builtins__': {}}, {})

    def test_readback_after_failed_upload_does_not_certify_a_failed_job(self):
        self.assertTrue(self.workflow_condition('Verify deployed source', success=False))
        self.assertFalse(self.workflow_condition('Record deployed commit', success=False))
        self.assertTrue(self.workflow_condition('Verify deployed source'))
        self.assertTrue(self.workflow_condition('Record deployed commit'))
        for state in ['failure', 'skipped']:
            self.assertFalse(self.workflow_condition('Record deployed commit', **{'steps.readback.outcome': state}))

    def test_readback_requires_valid_source_preflight_and_uncancelled_work(self):
        for changes in [{'steps.affected.outcome': 'failure'}, {'steps.affected.outcome': 'skipped'},
                        {'steps.affected.outputs.count': '0'}, {'steps.preflight.outcome': 'failure'},
                        {'steps.preflight.outcome': 'skipped'}]:
            with self.subTest(changes=changes):
                self.assertFalse(self.workflow_condition('Verify deployed source', success=False, **changes))
        self.assertFalse(self.workflow_condition('Verify deployed source', success=False, cancelled=True))
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        preflight = workflow.split('- name: Preflight — the provider accepts the credential', 1)[1].split('\n      - name:', 1)[0]
        self.assertIn('id: preflight', preflight)

    def test_pinned_expected_compiler_precedes_each_mandatory_contract_suite(self):
        for path, marker in [('.github/workflows/ci.yml', '- name: Edge release source'),
                             ('.github/workflows/deploy-edge-functions.yml', '- name: Test deployed-source')]:
            workflow = (ROOT / path).read_text(encoding='utf-8')
            setup = workflow.split('- name: Setup expected-source compiler', 1)[1].split(marker, 1)[0]
            self.assertIn('uses: denoland/setup-deno@v2', setup)
            self.assertIn('deno-version: v2.1.4', setup)
            self.assertNotIn('continue-on-error', setup)
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        for path in ['.github/scripts/edge-source-emit.ts', '.github/scripts/edge-source-emit.lock']:
            self.assertIn('"' + path + '"', workflow.split('workflow_dispatch:', 1)[0])

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
        self.assertIn('python3 .github/scripts/edge-deploy.py', workflow)
        self.assertIn('--expected-commit "${{ github.sha }}" --function "$fn"', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn('version: 2.116.0', workflow)
        self.assertNotIn('--no-verify-jwt', workflow)
        affected = workflow.split('- name: Resolve affected functions', 1)[1].split('- name: Setup Supabase CLI', 1)[0]
        self.assertNotIn('if:', affected, 'An empty selected set must still produce count=0')
        self.assertIn('edge-affected.py < changed.txt', affected)
        self.assertIn('set -euo pipefail', affected, 'Rejected local configuration must stop selection before success/count outputs')
        self.assertIn("refs/tags/edge-live^{commit}", affected, 'The project trust anchor is the certified release, never a failed event predecessor')
        self.assertIn('--baseline-commit "$certified_before"', affected)
        for name in ['Setup Supabase CLI', 'Preflight — the provider accepts the credential',
                     'Delete retired functions at the provider', 'Deploy affected functions', 'Verify deployed source']:
            step = workflow.split(f'- name: {name}', 1)[1].split('\n      - name:', 1)[0]
            self.assertIn("steps.affected.outcome == 'success'", step.split('if:', 1)[1].splitlines()[0],
                          f'Every provider boundary must require successful local target validation: {name}')


class ReleaseFixtures(unittest.TestCase):
    def test_frontend_runtime_import_is_rejected_before_provider_io(self):
        self.files['src/solo/sales/invoiceDraftSnapshot.ts'] = 'export const amount = 100;\n'
        self.files['supabase/functions/paige-ai-chat/index.ts'] = (
            'import { amount } from "../../../src/solo/sales/invoiceDraftSnapshot.ts";\n'
            'export const outcome = amount;\n')
        self.recommit()
        with self.assertRaisesRegex(readback.ReadbackError, 'unsupported_local_source_root'):
            self.verify()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.downloads, [])

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
        self.git('tag', '-f', 'edge-live', self.commit)
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
        if self.mode == 'missing-configured-import-map':
            files.pop('supabase/functions/paige-ai-chat/deno.json', None)
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

    def test_source_mismatch_reports_only_known_source_identity_and_hashes(self):
        self.mode = 'stale-chat'
        report = self.verify()
        self.assert_failed(report, 'deployed_source_mismatch')
        row = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        path = 'supabase/functions/_shared/authority.ts'
        self.assertEqual(row['diagnostic'], {
            'category': 'source_sha256_mismatch', 'source_scope': 'expected_closure',
            'file': path, 'download_mode': 'api',
            'expected_sha256': readback.digest(self.files[path].encode()),
            'downloaded_sha256': readback.digest(b'export const owner = "old fixture";\n'),
        })
        self.assertNotIn('fixture owner', json.dumps(report))
        self.assertNotIn('old fixture', json.dumps(report))
        self.assertNotIn(str(self.repo), json.dumps(report))
        self.assertEqual(next(r for r in report['functions'] if r['function'] == 'crm-command')['status'], 'PASS')

    def test_additional_repository_mismatch_does_not_publish_unexpected_download_names(self):
        path = 'supabase/functions/optional/unused.ts'
        self.files[path] = 'export const original = "PRIVATE_FIXTURE_ORIGINAL";\n'
        self.recommit()
        self.mode = 'tracked-extra'
        original = self.runner
        def runner(args, directory, timeout):
            result = original(args, directory, timeout)
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                (directory / path).write_text('PRIVATE_FIXTURE_DOWNLOADED\n', encoding='utf-8')
            return result
        report = readback.verify(self.repo, self.commit, self.names, runner, self.sleeps.append)
        self.assert_failed(report, 'deployed_source_mismatch')
        diagnostic = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')['diagnostic']
        self.assertEqual(diagnostic['source_scope'], 'additional_repository_source')
        self.assertNotIn('file', diagnostic)
        self.assertNotIn(path, json.dumps(diagnostic))
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_unknown_download_name_does_not_gain_source_identity_diagnostics(self):
        self.mode = 'extra-untracked'
        report = self.verify()
        self.assertFalse(report['all_pass'])
        self.assertTrue(all('diagnostic' not in row for row in report['functions']))
        self.assertNotIn('untracked.ts', json.dumps(report))

    @contextlib.contextmanager
    def cleanup_failure(self, error):
        original = tempfile.TemporaryDirectory
        created = []
        def factory(*args, **kwargs):
            temporary = original(*args, **kwargs)
            if kwargs.get('prefix') == 'paige-edge-readback-':
                cleanup = temporary.cleanup
                def fail():
                    raise error
                temporary.cleanup = fail
                created.append(cleanup)
            return temporary
        with patch.object(readback.tempfile, 'TemporaryDirectory', factory):
            try:
                yield
            finally:
                # Each saved callable belongs to its original generated test
                # temporary directory. Never remove a caller-computed path.
                for cleanup in created:
                    cleanup()

    def test_permission_cleanup_preserves_verified_source_and_reports_scratch(self):
        with self.cleanup_failure(PermissionError(13, 'PRIVATE_FIXTURE_PERMISSION_PATH')):
            report = self.verify()
        self.assertTrue(report['all_pass'])
        self.assertTrue(all(row['status'] == 'PASS' for row in report['functions']))
        self.assertEqual(report['scratch_cleanup'], {'status': 'incomplete', 'reason': 'permission_denied'})
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_permission_cleanup_cannot_launder_a_source_mismatch(self):
        self.mode = 'stale-chat'
        with self.cleanup_failure(PermissionError(13, 'PRIVATE_FIXTURE_PERMISSION_PATH')):
            report = self.verify()
        self.assert_failed(report, 'deployed_source_mismatch')
        self.assertEqual(next(r for r in report['functions'] if r['function'] == 'crm-command')['status'], 'PASS')
        self.assertEqual(report['scratch_cleanup']['status'], 'incomplete')

    def test_other_cleanup_os_error_is_not_ignored(self):
        with self.cleanup_failure(OSError(5, 'PRIVATE_FIXTURE_IO_PATH')):
            with self.assertRaises(OSError):
                self.verify()

    def test_permission_without_known_errno_is_not_ignored(self):
        with self.cleanup_failure(PermissionError('PRIVATE_FIXTURE_UNKNOWN_PATH')):
            with self.assertRaises(PermissionError):
                self.verify()

    def test_temporary_setup_os_error_remains_a_failure(self):
        with patch.object(readback.tempfile, 'TemporaryDirectory', side_effect=OSError(24, 'PRIVATE_FIXTURE_SETUP_PATH')):
            with self.assertRaises(OSError):
                self.verify()
        self.assertEqual(self.calls, [])

    def test_source_permission_failure_is_not_a_cleanup_warning_or_pass(self):
        original = self.runner
        def runner(args, directory, timeout):
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                raise PermissionError(13, 'PRIVATE_FIXTURE_SOURCE_PATH')
            return original(args, directory, timeout)
        report = readback.verify(self.repo, self.commit, self.names, runner, self.sleeps.append)
        self.assert_failed(report, 'invalid_download_source')
        self.assertNotIn('scratch_cleanup', report)
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_outer_os_failure_has_only_safe_errno_and_static_sites(self):
        selected = self.repo / 'selected-fixture.txt'
        selected.write_text('\n'.join(self.names) + '\n', encoding='utf-8')
        output = self.repo / 'report-fixture.json'
        with patch.object(readback, 'verify', side_effect=OSError(5, 'PRIVATE_FIXTURE_OS_PATH')), contextlib.redirect_stdout(io.StringIO()):
            status = readback.main(['--repo', str(self.repo), '--expected-commit', self.commit,
                                    '--functions', str(selected), '--report', str(output)])
        report = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(status, 1)
        self.assertFalse(report['all_pass'])
        self.assertEqual(report['reason'], 'invalid_readback_input')
        self.assertEqual(report['diagnostic']['category'], 'readback_os_error')
        self.assertEqual(report['diagnostic']['errno'], 5)
        self.assertEqual(report['diagnostic']['phase'], 'verification_input')
        self.assertTrue(all(set(site) == {'function', 'line'} for site in report['diagnostic']['sites']))
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

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

    def test_invalid_download_value_retains_safe_phase_and_other_original_checks(self):
        original = self.runner
        def runner(args, directory, timeout):
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                raise ValueError('PRIVATE_FIXTURE_AUTH_HEADER_AND_BODY')
            return original(args, directory, timeout)
        report = readback.verify(self.repo, self.commit, self.names, runner, self.sleeps.append)
        self.assert_failed(report, 'invalid_readback_data')
        row = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        self.assertEqual(row['diagnostic']['phase'], 'download_api')
        self.assertEqual(next(r for r in report['functions'] if r['function'] == 'crm-command')['status'], 'PASS')
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_invalid_vendor_value_does_not_erase_its_read_boundary(self):
        original = self.runner
        def runner(args, directory, timeout):
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                if '--use-api' in args:
                    raise readback.ReadbackError('api_unbundle_failed')
                raise ValueError('PRIVATE_FIXTURE_VENDOR_PAYLOAD')
            return original(args, directory, timeout)
        report = readback.verify(self.repo, self.commit, self.names, runner, self.sleeps.append)
        self.assert_failed(report, 'invalid_readback_data')
        row = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        self.assertEqual(row['diagnostic']['phase'], 'download_vendor')
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_invalid_manifest_value_is_not_a_source_match(self):
        original = readback.downloaded_manifest
        def manifest(repo, commit, directory, expected):
            if 'paige-ai-chat' in expected['entrypoint']:
                raise ValueError('PRIVATE_FIXTURE_SOURCE_PAYLOAD')
            return original(repo, commit, directory, expected)
        with patch.object(readback, 'downloaded_manifest', manifest):
            report = self.verify()
        self.assert_failed(report, 'invalid_readback_data')
        row = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        self.assertEqual(row['diagnostic']['phase'], 'downloaded_source')
        self.assertTrue(all(set(site) == {'function', 'line'} for site in row['diagnostic']['sites']))
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

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

    def test_upload_success_and_matching_metadata_cannot_hide_missing_compiler_file(self):
        self.files['supabase/config.toml'] += (
            '[functions.paige-ai-chat]\n'
            'import_map = "./functions/paige-ai-chat/deno.json"\n')
        self.files['supabase/functions/paige-ai-chat/deno.json'] = (
            '{"compilerOptions":{"strict":true},"imports":{}}\n')
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/paige-ai-chat/deno.json'
        self.recommit()
        self.assertTrue(self.verify()['all_pass'])
        self.mode = 'missing-configured-import-map'
        report = self.verify()
        self.assert_failed(report, 'download_missing_dependency')
        self.assertEqual(report['functions'][1]['status'], 'PASS')
        self.mode = 'good'
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

    def test_exact_server_unbundle_failure_has_only_a_fixed_reason(self):
        message = 'Error status 500: {"message":"Failed to retrieve function bundle"}'
        envelope = json.dumps({'_tag': 'Error', 'error': {'code': 'UnknownError', 'message': message}})
        for stdout, stderr in [('', message), (envelope, '')]:
            with self.subTest(stdout=bool(stdout)):
                error = subprocess.CalledProcessError(1, ['supabase'], output=stdout, stderr=stderr)
                with patch.object(readback.subprocess, 'run', side_effect=error):
                    with self.assertRaisesRegex(readback.ReadbackError, '^api_unbundle_failed$'):
                        readback.cli(['functions', 'download', 'paige-ai-chat', '--use-api'], self.repo, 1)
                    with self.assertRaisesRegex(readback.ReadbackError, '^cli_readback_failed$'):
                        readback.cli(['functions', 'list'], self.repo, 1)
                    with self.assertRaisesRegex(readback.ReadbackError, '^cli_readback_failed$'):
                        readback.cli(['functions', 'download', 'paige-ai-chat', '--use-docker'], self.repo, 1)

    def test_auth_uncertainty_and_reflected_unbundle_text_never_admit_docker(self):
        message = 'Error status 500: {"message":"Failed to retrieve function bundle"}'
        errors = [subprocess.TimeoutExpired('supabase', 1), OSError('test-private-header')]
        errors += [subprocess.CalledProcessError(code, ['supabase'], output=out, stderr=err)
                   for code, out, err in [
                       (-1, '', message), (2, '', message),
                       (1, '', message.replace('500', '403')),
                       (1, '', message.replace('500', '401')),
                       (1, '', message.replace('500', '429')),
                       (1, '', message.replace('500', '502')),
                       (1, message, ''), (1, '', 'reflected: ' + message),
                       (1, '', message + '\n' + message),
                       (1, '', message + '\nError status 403: denied'),
                       (1, '', message.replace('bundle"}', 'bundle","extra":true}')),
                       (1, '', message.replace('{"message":', '{"message":"other","message":')),
                       (1, json.dumps({'message': message}), ''),
                       (1, '', message + 'x' * (1024 * 1024)),
                   ]]
        for error in errors:
            with self.subTest(error=type(error).__name__, code=getattr(error, 'returncode', None)):
                with patch.object(readback.subprocess, 'run', side_effect=error):
                    with self.assertRaisesRegex(readback.ReadbackError, '^cli_readback_failed$'):
                        readback.cli(['functions', 'download', 'paige-ai-chat', '--use-api'], self.repo, 1)

    def verify_with_server_unbundle_failure(self):
        self.recovery_calls = []
        def runner(args, directory, timeout):
            self.recovery_calls.append((args, directory, timeout))
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                if args[3] == '--use-api':
                    raise readback.ReadbackError('api_unbundle_failed')
                self.assertEqual(args[3], '--use-docker')
                self.assertEqual((directory / 'supabase/config.toml').read_text(),
                                 'project_id = "test-project"\n')
                # Supply the original file fixture at the real downloader boundary.
                # No mocked acceptance: the unchanged manifest/race verifier runs.
                return self.runner([*args[:3], '--use-api', *args[4:]], directory, timeout)
            return self.runner(args, directory, timeout)
        return readback.verify(self.repo, self.commit, self.names, runner, self.sleeps.append)

    def test_vendor_download_recovery_requires_original_full_source_and_metadata(self):
        report = self.verify_with_server_unbundle_failure()
        self.assertTrue(report['all_pass'])
        chat = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        self.assertEqual(chat['download_mode'], 'docker_requested')
        self.assertIn('supabase/functions/_shared/authority.ts', chat['files'])
        calls = [c for c in self.recovery_calls if c[0][:2] == ['functions', 'download']]
        self.assertEqual([c[0][3] for c in calls], ['--use-api', '--use-docker', '--use-api'])
        self.assertNotEqual(calls[0][1], calls[1][1], 'Never mix partial API and Docker trees')
        for args, directory, timeout in calls:
            self.assertEqual(args[-2:], ['--project-ref', 'test-project'])
            self.assertFalse(directory.is_relative_to(self.repo))
            self.assertGreater(timeout, 0)
            self.assertLessEqual(timeout, 60)
            self.assertNotIn('deploy', args)
            self.assertNotIn('--no-verify-jwt', args)

    def test_recovered_download_cannot_hide_source_or_identity_failure(self):
        for mode, reason in [('stale-chat', 'deployed_source_mismatch'),
                             ('empty-download', 'download_missing_source'),
                             ('missing-dependency', 'download_missing_dependency'),
                             ('extra-untracked', 'immutable_source_unavailable'),
                             ('changing-version', 'deployment_changed_during_readback')]:
            with self.subTest(mode=mode):
                self.mode = mode
                self.assert_failed(self.verify_with_server_unbundle_failure(), reason)
                self.assertLessEqual(sum(c[0][3] == '--use-docker' for c in self.recovery_calls
                                         if c[0][:2] == ['functions', 'download']), readback.MAX_ATTEMPTS)

    def test_unproved_import_map_cannot_select_local_download_recovery(self):
        self.files['supabase/functions/paige-ai-chat/deno.json'] = '{"imports":{}}\n'
        self.recommit()
        self.rows[0]['import_map_path'] = 'file:///app/supabase/functions/paige-ai-chat/deno.json'
        report = self.verify_with_server_unbundle_failure()
        self.assert_failed(report, 'local_import_map_readback_unverified')
        self.assertFalse(any('--use-docker' in c[0] for c in self.recovery_calls))

    def test_recovery_deadline_does_not_start_a_second_read(self):
        times = iter([0, 0, 0] + [readback.MAX_SECONDS + 1] * 20)
        calls = []
        def runner(args, directory, timeout):
            calls.append(args)
            if args[:2] == ['functions', 'download']:
                raise readback.ReadbackError('api_unbundle_failed')
            return self.runner(args, directory, timeout)
        report = readback.verify(self.repo, self.commit, self.names, runner,
                                 self.sleeps.append, lambda: next(times))
        self.assertFalse(report['all_pass'])
        self.assertFalse(any('--use-docker' in args for args in calls))

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

    def run_actual_deployment_baseline(self, event_before):
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        step = workflow.split('- name: Resolve deployment baseline', 1)[1].split('- name: Compute changed function files', 1)[0]
        script = textwrap.dedent(step.split('run: |', 1)[1])
        script = script.replace('${{ github.sha }}', self.commit).replace('${{ github.event.before }}', event_before)
        script = script.replace('${{ github.event_name }}', 'push')
        bash = shutil.which('bash') or (r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
        self.assertTrue(bash and Path(bash).is_file())
        return subprocess.run([bash, '-e', '-c', script], cwd=self.repo, capture_output=True, text=True,
                              timeout=15, env={**os.environ, 'GITHUB_OUTPUT': 'baseline-output.txt'})

    def run_actual_upload_requirement(self, before, event='push', retired='0'):
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        self.assertIn('- name: Resolve upload necessity', workflow)
        step = workflow.split('- name: Resolve upload necessity', 1)[1].split('\n      - name:', 1)[0]
        script = textwrap.dedent(step.split('run: |', 1)[1])
        for expression, value in {'github.sha': self.commit, 'github.event.before': before,
                                  'github.event_name': event, 'steps.retired.outputs.count': retired}.items():
            script = script.replace('${{ ' + expression + ' }}', value)
        output = self.repo / 'upload-output.txt'
        output.unlink(missing_ok=True)
        bash = shutil.which('bash') or (r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
        self.assertTrue(bash and Path(bash).is_file())
        result = subprocess.run([bash, '-e', '-c', script], cwd=self.repo, capture_output=True, text=True,
                                timeout=15, env={**os.environ, 'GITHUB_OUTPUT': str(output)})
        self.assertEqual(result.returncode, 0, result.stderr)
        return dict(line.split('=', 1) for line in output.read_text().splitlines())['required']

    def test_helper_only_recovery_reads_the_full_gap_without_another_upload(self):
        certified = self.commit
        self.files['supabase/functions/_shared/authority.ts'] += '// acknowledged but unverified fixture\n'
        self.recommit()
        acknowledged = self.commit
        self.files['readback-correction.txt'] = 'Neutral helper-only fixture\n'
        self.recommit()
        self.assertEqual(self.run_actual_upload_requirement(acknowledged), 'false')
        self.assertIn('paige-ai-chat', self.select_as_workflow(certified))
        result, calls = self.run_actual_provider_step('Deploy affected functions', upload_required='false')
        self.assertIsNone(result)
        self.assertEqual(calls, [])
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        read_step = workflow.split('- name: Verify deployed source', 1)[1].split('env:', 1)[0]
        self.assertNotIn('steps.upload', read_step, 'Skipped uploads cannot skip original full source proof')
        tag = workflow.split('- name: Record deployed commit', 1)[1]
        self.assertIn("steps.readback.outcome == 'success'", tag)

    def test_source_config_manual_unknown_and_retirement_keep_normal_uploads(self):
        before = self.commit
        self.files['supabase/functions/_shared/authority.ts'] += '// new function source\n'
        self.recommit()
        self.assertEqual(self.run_actual_upload_requirement(before), 'true')
        before = self.commit
        self.files['supabase/config.toml'] += '[functions.paige-ai-chat]\nverify_jwt = false\n'
        self.recommit()
        self.assertEqual(self.run_actual_upload_requirement(before), 'true')
        for bad in ['', '0' * 40, 'not-a-commit', 'f' * 40]:
            self.assertEqual(self.run_actual_upload_requirement(bad), 'true')
        self.assertEqual(self.run_actual_upload_requirement(self.commit, event='workflow_dispatch'), 'true')
        self.assertEqual(self.run_actual_upload_requirement(self.commit, retired='1'), 'true')

    def test_push_recovery_selects_original_unverified_gap_not_only_event_before(self):
        certified = self.commit
        self.git('remote', 'add', 'origin', str(self.repo))
        self.files['supabase/functions/_shared/authority.ts'] += '// unverified upload\n'
        self.recommit()
        unverified = self.commit
        self.files['readback-fix.txt'] = 'Source-only helper correction fixture\n'
        self.recommit()
        result = self.run_actual_deployment_baseline(unverified)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = (self.repo / 'baseline-output.txt').read_text().splitlines()
        self.assertIn(f'before={certified}', output)
        self.assertIn(f'after={self.commit}', output)
        selected = self.select_as_workflow(certified)
        self.assertIn('paige-ai-chat', selected)
        self.assertEqual(self.run_actual_tag_guard(certified).returncode, 0)

    def test_baseline_rejects_missing_noncommit_foreign_and_unfetchable_anchors(self):
        certified = self.commit
        self.git('remote', 'add', 'origin', str(self.repo))
        blob = self.git('rev-parse', f'{self.commit}:supabase/config.toml').strip()
        foreign = self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                           'commit-tree', self.git('rev-parse', 'HEAD^{tree}').strip(), '-m', 'Foreign anchor').strip()
        for anchor in [None, blob, foreign]:
            with self.subTest(anchor=anchor):
                self.git('tag', '-f', 'edge-live', certified)
                self.git('tag', '-d', 'edge-live')
                if anchor:
                    self.git('tag', 'edge-live', anchor)
                (self.repo / 'baseline-output.txt').unlink(missing_ok=True)
                self.assertNotEqual(self.run_actual_deployment_baseline(self.commit).returncode, 0)
                self.assertFalse((self.repo / 'baseline-output.txt').exists())
        self.git('tag', '-f', 'edge-live', certified)
        self.git('remote', 'remove', 'origin')
        self.assertNotEqual(self.run_actual_deployment_baseline(self.commit).returncode, 0)

    def select_as_workflow(self, before):
        """Execute the actual selection shell, graph and helper; never invokes a provider."""
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        affected = workflow.split('- name: Resolve affected functions', 1)[1].split('- name: Setup Supabase CLI', 1)[0]
        tools = self.repo / '.github/scripts'
        tools.mkdir(parents=True, exist_ok=True)
        for name in ['edge-affected.py', 'edge-source-readback.py']:
            shutil.copyfile(ROOT / '.github/scripts' / name, tools / name)
        changed = self.git('diff', '--name-only', before, self.commit, '--', 'supabase/functions/**')
        (self.repo / 'changed.txt').write_text(changed, encoding='utf-8', newline='\n')
        script = textwrap.dedent(affected.split('run: |', 1)[1])
        script = script.replace('${{ steps.baseline.outputs.before }}', before).replace('${{ github.sha }}', self.commit)
        executable = Path(os.sys.executable).as_posix()
        stub = f'python3() {{ "{executable}" "$@"; }};\n'
        bash = shutil.which('bash') or (r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
        self.assertTrue(bash and Path(bash).is_file())
        result = subprocess.run([bash, '-e', '-c', stub + script], cwd=self.repo, capture_output=True, text=True,
                                timeout=30, env={**os.environ, 'GITHUB_OUTPUT': 'selection-output.txt', 'PYTHONDONTWRITEBYTECODE': '1'})
        if result.returncode:
            raise readback.ReadbackError('configuration_selection_refused')
        return (self.repo / 'affected.txt').read_text(encoding='utf-8').splitlines()

    def test_manual_config_only_change_selects_the_exact_function(self):
        before = self.commit
        self.git('tag', '-f', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        self.assertEqual(self.select_as_workflow(before), ['crm-command'])

    def test_explicit_true_sender_options_are_selected_without_changing_expected_source(self):
        names = ['dispatch-stage-automation', 'send-message']
        for name in names:
            self.files[f'supabase/functions/{name}/index.ts'] = 'export const sender = "protected fixture";\n'
        self.recommit()
        before = self.commit
        self.git('tag', '-f', 'edge-live', before)
        _, previous = readback.expected_release(self.repo, before, names)
        self.assertTrue(all(previous[name]['verify_jwt'] is True for name in names))

        for name in names:
            self.files['supabase/config.toml'] += f'\n[functions.{name}]\nverify_jwt = true\n'
        self.recommit()
        _, current = readback.expected_release(self.repo, self.commit, names)
        self.assertEqual(current, previous, 'Explicit default must preserve every expected source/options identity')
        self.assertEqual(self.select_as_workflow(before), names, 'Raw declarations must select both existing senders')
        with self.assertRaisesRegex(readback.ReadbackError, 'function_configuration_not_verified'):
            readback.configuration_selection(self.repo, before, self.commit, [], require_coverage=True)
        self.assertEqual(readback.configuration_selection(self.repo, before, self.commit, names, require_coverage=True), names)

        self.rows = [self.row(name) for name in names]
        report = readback.verify(self.repo, self.commit, names, self.runner, self.sleeps.append)
        self.assertTrue(report['all_pass'])
        self.assertTrue(all(row['status'] == 'PASS' for row in report['functions']))
        self.rows[0]['verify_jwt'] = False
        self.calls, self.downloads = [], []
        report = readback.verify(self.repo, self.commit, names, self.runner, self.sleeps.append)
        self.assert_failed(report, 'jwt_configuration_mismatch', function=names[0])
        self.assertNotIn(names[0], self.downloads, 'Wrong gateway posture must refuse before source download')

    def test_manual_config_and_unrelated_source_both_require_readback(self):
        before = self.commit
        self.git('tag', '-f', 'edge-live', before)
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
        self.git('tag', '-f', 'edge-live', before)
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
        self.git('tag', '-f', 'edge-live', before)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('test-project', 'different-test-project')
        self.recommit()
        self.assertNotEqual(self.run_actual_tag_guard(before).returncode, 0)

    def test_config_only_manual_recovery_passes_guard_after_exact_selection(self):
        before = self.commit
        self.git('tag', '-f', 'edge-live', before)
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

    def prepare_retirement(self, configuration_change=None, frontend_between=False):
        source = 'supabase/functions/retired-fixture/index.ts'
        self.files[source] = 'export const retired = true;\n'
        self.recommit()
        before = self.commit
        self.git('tag', '-f', 'edge-live', before)
        if frontend_between:
            self.files['presentation.txt'] = 'An unrelated presentation-only push\n'
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

    def run_actual_provider_step(self, name, selection='success', retirement='success', job_success=True, upload_required=''):
        """Evaluate the actual bounded step condition and execute only its stubbed shell."""
        workflow = (ROOT / '.github/workflows/deploy-edge-functions.yml').read_text(encoding='utf-8')
        step = workflow.split(f'- name: {name}', 1)[1].split('\n      - name:', 1)[0]
        condition = step.split('if:', 1)[1].splitlines()[0].strip()
        if not any(status in condition for status in ['always()', 'success()', 'failure()', 'cancelled()']):
            condition = f'({condition}) && success()'  # GitHub's implicit default status check.
        values = {'steps.affected.outcome': selection, 'steps.retired.outcome': retirement,
                  'steps.upload.outputs.required': upload_required,
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

    def test_failed_project_switch_cannot_be_laundered_by_the_next_push(self):
        source = 'supabase/functions/retired-fixture/index.ts'
        self.files[source] = 'export const retired = true;\n'
        self.recommit()
        anchor = self.commit
        self.git('tag', '-f', 'edge-live', anchor)
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('test-project', 'different-test-project')
        self.recommit()
        failed_push = self.commit
        with self.assertRaisesRegex(readback.ReadbackError, 'configuration_selection_refused'):
            self.select_as_workflow(anchor)
        self.files.pop(source)
        (self.repo / source).unlink()
        (self.repo / source).parent.rmdir()
        self.recommit()
        (self.repo / 'retired.txt').write_text('retired-fixture\n', encoding='utf-8', newline='\n')
        selection = 'success'
        try:
            self.select_as_workflow(failed_push)
        except readback.ReadbackError:
            selection = 'failure'
        result, calls = self.run_actual_provider_step('Delete retired functions at the provider', selection=selection)
        self.assertIsNone(result, f'A failed predecessor is no project authority; sink calls={calls}')
        self.assertEqual(selection, 'failure')
        self.assertEqual(calls, [])

    def test_unverified_configuration_is_selected_again_after_a_new_source_push(self):
        anchor = self.commit
        self.files['supabase/config.toml'] = self.files['supabase/config.toml'].replace('verify_jwt = false', 'verify_jwt = true')
        self.recommit()
        unverified = self.commit
        self.names = self.select_as_workflow(anchor)
        self.assert_failed(self.verify(), 'jwt_configuration_mismatch', 'crm-command')
        self.files['supabase/functions/paige-ai-chat/index.ts'] += '// next unrelated source push\n'
        self.recommit()
        self.names = self.select_as_workflow(unverified)
        self.assertEqual(set(self.names), {'crm-command', 'paige-ai-chat'})
        self.rows[1]['verify_jwt'] = True
        self.assertTrue(self.verify()['all_pass'])

    def test_same_project_frontend_push_preserves_authorized_retirement(self):
        before = self.prepare_retirement(frontend_between=True)
        self.assertEqual(self.select_as_workflow(before), [])
        result, calls = self.run_actual_provider_step('Delete retired functions at the provider', job_success=False)
        self.assertIsNotNone(result)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['functions delete retired-fixture --project-ref test-project --yes'])

    def test_missing_or_noncommit_certified_anchor_refuses_before_provider_mutation(self):
        before = self.prepare_retirement()
        blob = self.git('rev-parse', f'{before}:supabase/config.toml').strip()
        for anchor in [None, blob]:
            if anchor is None:
                self.git('tag', '-d', 'edge-live')
            else:
                self.git('update-ref', 'refs/tags/edge-live', anchor)
            selection = 'success'
            try:
                self.select_as_workflow(before)
            except readback.ReadbackError:
                selection = 'failure'
            result, calls = self.run_actual_provider_step('Delete retired functions at the provider', selection=selection)
            self.assertIsNone(result, f'Unprovable release anchor cannot authorize a provider mutation: {calls}')
            self.assertEqual(selection, 'failure')
            self.assertEqual(calls, [])

    def test_prior_unverified_source_cannot_be_skipped_by_a_later_push(self):
        self.git('tag', '-f', 'edge-live', self.commit)
        self.files['supabase/functions/_shared/authority.ts'] += '// prior source not verified\n'
        self.recommit()
        result = self.run_actual_tag_guard(self.commit)
        self.assertNotEqual(result.returncode, 0, 'Later selected-set success cannot certify an older skipped source gap')

    def test_frontend_only_commits_do_not_hold_valid_source_tag(self):
        self.git('tag', '-f', 'edge-live', self.commit)
        (self.repo / 'presentation.txt').write_text('Unrelated presentation fixture\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Frontend fixture')
        before = self.git('rev-parse', 'HEAD').strip()
        self.commit = before
        self.assertEqual(self.run_actual_tag_guard(before).returncode, 0)

    def test_existing_manual_recovery_baseline_passes_tag_guard(self):
        self.git('tag', '-f', 'edge-live', self.commit)
        before = self.commit
        self.files['supabase/functions/_shared/authority.ts'] += '// recovery source\n'
        self.recommit()
        self.assertEqual(self.run_actual_tag_guard(before).returncode, 0)


class CompiledRuntimeFixtures(unittest.TestCase):
    def setUp(self):
        self.fixture = ReleaseFixtures('test_frontend_runtime_import_is_rejected_before_provider_io')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.path = 'supabase/functions/_shared/authority.ts'
        self.source = 'export const owner: string = "fixture owner";\n'
        self.code = 'export const owner = "fixture owner";\n'
        self.fixture.files[self.path] = self.source
        self.fixture.recommit()
        self.compiled = {self.path: readback.digest(self.code.encode())}

    def verify(self, *, api=False, code=None, compiler=None, clock=None):
        fixture = self.fixture
        original = fixture.runner
        def runner(args, directory, timeout):
            if args[:3] == ['functions', 'download', 'paige-ai-chat']:
                if '--use-api' in args and not api:
                    raise readback.ReadbackError('api_unbundle_failed')
                result = original([*args[:3], '--use-api', *args[4:]], directory, timeout)
                if (directory / self.path).exists():
                    (directory / self.path).write_text(self.code if code is None else code, encoding='utf-8')
                return result
            return original(args, directory, timeout)
        with patch.object(readback, 'compiled_sources', create=True,
                          **({'side_effect': compiler} if compiler else {'return_value': self.compiled})) as emit:
            kwargs = {'clock': clock} if clock else {}
            result = readback.verify(fixture.repo, fixture.commit, fixture.names, runner, fixture.sleeps.append, **kwargs)
        return result, emit

    def test_exact_emitted_expected_bytes_certify_only_vendor_download(self):
        report, emit = self.verify()
        self.assertTrue(report['all_pass'], 'Actual compiled bytes must match the deterministic expected compilation')
        self.assertEqual(emit.call_count, 1)
        self.assertGreater(emit.call_args.args[3], 0)
        self.assertLessEqual(emit.call_args.args[3], 60)
        row = next(r for r in report['functions'] if r['function'] == 'paige-ai-chat')
        self.assertEqual(row['emitted_files'][self.path], {
            'compiler': '@deno/emit@0.46.0', 'source_sha256': readback.digest(self.source.encode()),
            'sha256': readback.digest(self.code.encode()),
        })
        sources = emit.call_args.args[2]
        self.assertEqual(sources, {self.path: self.source.encode()})
        self.assertNotIn(self.code, sources.values(), 'The compiler must never receive downloaded executable code')

    def test_api_source_mismatch_cannot_request_compilation(self):
        report, emit = self.verify(api=True)
        self.fixture.assert_failed(report, 'deployed_source_mismatch')
        emit.assert_not_called()

    def test_altered_executable_literal_or_added_statement_stays_refused(self):
        for code in [self.code.replace('fixture owner', 'foreign owner'), self.code + 'globalThis.changed = true;\n',
                     self.code + '//# sourceMappingURL=data:application/json;base64,e30=\n']:
            report, _ = self.verify(code=code)
            self.fixture.assert_failed(report, 'deployed_source_mismatch')
            self.assertNotIn('foreign owner', json.dumps(report))

    def test_compiler_completion_after_original_deadline_cannot_certify(self):
        now = [0]
        def compiler(*args):
            now[0] = readback.MAX_SECONDS + 1
            return self.compiled
        report, emit = self.verify(compiler=compiler, clock=lambda: now[0])
        self.fixture.assert_failed(report, 'verification_budget_exhausted')
        self.assertEqual(emit.call_count, 1)

    def test_unavailable_or_untrusted_compiler_is_never_source_proof(self):
        for error in [OSError('PRIVATE_FIXTURE_CREDENTIAL'),
                      readback.ReadbackError('expected_compiler_failed')]:
            def compiler(*args):
                raise error
            report, _ = self.verify(compiler=compiler)
            self.fixture.assert_failed(report, 'deployed_source_mismatch')
            self.assertNotIn('PRIVATE_FIXTURE', json.dumps(report))

    def test_compilation_does_not_hide_configuration_or_identity_failure(self):
        self.fixture.rows[0]['verify_jwt'] = False
        report, emit = self.verify()
        self.fixture.assert_failed(report, 'jwt_configuration_mismatch')
        emit.assert_not_called()
        self.fixture.rows[0]['verify_jwt'] = True
        self.fixture.mode = 'changing-version'
        report, _ = self.verify()
        self.fixture.assert_failed(report, 'deployment_changed_during_readback')

    def test_missing_dependency_and_unknown_file_stay_refused(self):
        for mode, reason in [('missing-dependency', 'download_missing_dependency'),
                             ('extra-untracked', 'immutable_source_unavailable')]:
            self.fixture.mode = mode
            report, emit = self.verify()
            self.fixture.assert_failed(report, reason)
            emit.assert_not_called()

    def compiler_fixture(self):
        for relative in ['.github/scripts/edge-source-emit.ts', '.github/scripts/edge-source-emit.lock']:
            self.fixture.files[relative] = (ROOT / relative).read_text(encoding='utf-8')
        self.fixture.recommit()
        return readback.compiled_sources(
            self.fixture.repo, self.fixture.commit, {self.path: self.source.encode()},
            60, self.fixture.repo / 'compiler-cache')

    def test_real_frozen_vendor_compiler_matches_the_expected_executable_bytes(self):
        # Mandatory real compiler leg, no optional skip or downloaded source.
        self.assertEqual(self.compiler_fixture(), self.compiled)

    def test_compilation_does_not_execute_source_or_fetch_its_imports(self):
        self.source = ('import "https://unapproved.example.invalid/never-read.ts";\n'
                       'throw new Error("source must never execute");\n'
                       'export const owner: string = "fixture owner";\n')
        result = self.compiler_fixture()
        self.assertEqual(set(result), {self.path})
        self.assertRegex(result[self.path], '^[0-9a-f]{64}$')

    def test_compiler_process_has_no_provider_credentials_or_effect_permissions(self):
        self.compiler_fixture()
        response = {'version': 1, 'compiler': '@deno/emit@0.46.0', 'files': [{
            'path': self.path, 'source_sha256': readback.hashlib.sha256(self.source.encode()).hexdigest(),
            'sha256': self.compiled[self.path]}]}
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'PRIVATE_FIXTURE_CREDENTIAL'}), \
                patch.object(readback.subprocess, 'run', return_value=subprocess.CompletedProcess(
                    [], 0, json.dumps(response), '')) as run, \
                patch.object(readback, 'commit_file', return_value=b'verified helper fixture'):
            result = readback.compiled_sources(self.fixture.repo, self.fixture.commit,
                                               {self.path: self.source.encode()}, 17,
                                               self.fixture.repo / 'compiler-cache')
        self.assertEqual(result, self.compiled)
        args, kwargs = run.call_args.args[0], run.call_args.kwargs
        self.assertIn('--frozen', args)
        self.assertIn('--no-prompt', args)
        self.assertIn('--no-config', args)
        self.assertIn('--allow-net=jsr.io', args)
        self.assertFalse(any(arg == '-A' or arg.startswith(('--allow-read', '--allow-write',
                                                         '--allow-run', '--allow-env', '--allow-ffi')) for arg in args))
        self.assertNotIn('SUPABASE_ACCESS_TOKEN', kwargs['env'])
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(kwargs['env']))
        self.assertEqual(kwargs['timeout'], 17)

    def test_stale_helper_or_frozen_lock_refuses_before_compiler_process(self):
        self.compiler_fixture()
        for relative in ['.github/scripts/edge-source-emit.ts', '.github/scripts/edge-source-emit.lock']:
            path = self.fixture.repo / relative
            original = path.read_bytes()
            path.write_bytes(original + b'\nchanged\n')
            with patch.object(readback.subprocess, 'run', wraps=subprocess.run) as run:
                with self.assertRaisesRegex(readback.ReadbackError, 'checkout_differs_from_commit'):
                    readback.compiled_sources(self.fixture.repo, self.fixture.commit,
                                              {self.path: self.source.encode()}, 60,
                                              self.fixture.repo / 'compiler-cache')
            self.assertFalse(any(call.args[0][0] == 'deno' for call in run.call_args_list))
            path.write_bytes(original)

    def test_invalid_compiler_output_never_certifies_expected_bytes(self):
        row = {'path': self.path, 'source_sha256': readback.hashlib.sha256(self.source.encode()).hexdigest(),
               'sha256': self.compiled[self.path]}
        envelope = {'version': 1, 'compiler': '@deno/emit@0.46.0', 'files': [row]}
        invalid = ['not json', {**envelope, 'version': True}, {**envelope, 'compiler': 'unpinned'},
                   {**envelope, 'files': []}, {**envelope, 'files': [row, row]},
                   {**envelope, 'files': [{**row, 'path': 'foreign.ts'}]},
                   {**envelope, 'files': [{**row, 'source_sha256': '0' * 64}]},
                   {**envelope, 'files': [{**row, 'sha256': None}]}]
        for output in invalid:
            with patch.object(readback, 'commit_file', return_value=b'verified helper fixture'), \
                    patch.object(readback.subprocess, 'run', return_value=subprocess.CompletedProcess(
                        [], 0, output if isinstance(output, str) else json.dumps(output), '')):
                with self.assertRaisesRegex(readback.ReadbackError, 'expected_compiler_failed'):
                    readback.compiled_sources(self.fixture.repo, self.fixture.commit,
                                              {self.path: self.source.encode()}, 1,
                                              self.fixture.repo / 'compiler-cache')


class RepositoryRuntimeContracts(unittest.TestCase):
    def test_invoice_calculation_has_a_verifiable_edge_source_closure(self):
        spec = importlib.util.spec_from_file_location('invoice_repository_graph', ROOT / '.github/scripts/edge-affected.py')
        graph = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(graph)
        functions_root = (ROOT / 'supabase/functions').resolve()
        entry = functions_root / 'sales-invoice-draft-command/index.ts'
        closure = {Path(p).resolve() for p in readback.runtime_closure(graph, str(entry))}
        self.assertEqual([str(p.relative_to(ROOT)) for p in sorted(closure)
                          if not p.is_relative_to(functions_root)], [])
        self.assertIn(functions_root / '_shared/sales-commercial/invoice-amounts.ts', closure)

    def test_effectful_senders_explicitly_preserve_gateway_jwt_verification(self):
        config = readback.tomllib.loads((ROOT / 'supabase/config.toml').read_text(encoding='utf-8'))
        functions = config.get('functions', {})
        for name in ['send-message', 'dispatch-stage-automation']:
            with self.subTest(function=name):
                self.assertTrue(name in functions,
                                f'{name}: CLI2.116 preserves remote posture when the raw declaration is absent')
                self.assertIs(functions[name].get('verify_jwt'), True)
        self.assertIs(functions.get('skill-runner', {}).get('verify_jwt'), False,
                      'Its separately reviewed authenticate-first handler posture must remain unchanged')

    def test_inbound_attachment_type_is_not_an_expected_runtime_asset(self):
        spec = importlib.util.spec_from_file_location('repository_graph', ROOT / '.github/scripts/edge-affected.py')
        graph = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(graph)
        entry = ROOT / 'supabase/functions/handle-inbound-email/index.ts'
        expected = readback.runtime_closure(graph, str(entry))
        self.assertNotIn(str(ROOT / 'supabase/functions/_shared/email-attachments.ts'), expected)

    def test_skill_runner_declares_its_existing_handler_auth_posture_only(self):
        config = readback.tomllib.loads((ROOT / 'supabase/config.toml').read_text(encoding='utf-8'))
        self.assertIs(config.get('functions', {}).get('skill-runner', {}).get('verify_jwt'), False)
        self.assertIs(config.get('functions', {}).get('undeclared-fixture', {}).get('verify_jwt', True), True)



DEPLOY_SPEC = importlib.util.spec_from_file_location(
    'edge_deploy', ROOT / '.github/scripts/edge-deploy.py')
edge_deploy = importlib.util.module_from_spec(DEPLOY_SPEC)
DEPLOY_SPEC.loader.exec_module(edge_deploy)


class BoundedDeployFixtures(unittest.TestCase):
    """Actual helper and immutable native source; the CLI/provider is a double."""
    def setUp(self):
        self.fixture = ReleaseFixtures('test_frontend_runtime_import_is_rejected_before_provider_io')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.calls = []
        self.api_result = subprocess.CompletedProcess([], 0, 'do-not-publish-output', '')
        self.local_result = subprocess.CompletedProcess([], 0, '', '')
        self.docker_result = subprocess.CompletedProcess([], 0, 'fixture-version', '')
        self.after_api = lambda: None

    def runner(self, args, directory, timeout):
        self.assertEqual(directory, self.fixture.repo)
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 300)
        self.calls.append(args)
        if args[0] == 'docker':
            self.assertEqual(args, ['docker', 'info', '--format', '{{.ServerVersion}}'])
            if isinstance(self.docker_result, Exception):
                raise self.docker_result
            return self.docker_result
        expected = ['supabase', 'functions', 'deploy', 'paige-ai-chat',
                    '--project-ref', 'test-project', '--workdir', str(self.fixture.repo)]
        self.assertEqual(args[:-1], expected)
        self.assertNotIn('--no-verify-jwt', args)
        self.assertNotIn('--import-map', args)
        self.assertNotIn('--prune', args)
        if args[-1] == '--use-api':
            self.after_api()
            if isinstance(self.api_result, Exception):
                raise self.api_result
            return self.api_result
        self.assertEqual(args[-1], '--use-docker')
        if isinstance(self.local_result, Exception):
            raise self.local_result
        return self.local_result

    def run_deploy(self):
        return edge_deploy.deploy(self.fixture.repo, self.fixture.commit,
                                  'paige-ai-chat', runner=self.runner)

    def oversize(self):
        self.api_result = subprocess.CompletedProcess(
            [], 1, '', 'unexpected deploy status 413: ' +
            json.dumps({'message': edge_deploy.SIZE_MESSAGE}) + '\n')

    def test_api_acknowledgment_does_not_verify_source_or_try_docker(self):
        result = self.run_deploy()
        self.assertTrue(result['ok'])
        self.assertFalse(result['source_verified'])
        self.assertEqual(result['mode'], 'api')
        self.assertEqual(len(self.calls), 1)

    def test_exact_rejection_uses_same_source_project_slug_and_auth_once(self):
        self.oversize()
        result = self.run_deploy()
        self.assertTrue(result['ok'])
        self.assertFalse(result['source_verified'])
        self.assertEqual(result['mode'], 'local_requested')
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0][:-1], self.calls[2][:-1])
        self.assertEqual(self.calls[0][-1], '--use-api')
        self.assertEqual(self.calls[2][-1], '--use-docker')

    def test_auth_rate_limit_server_and_generic_size_errors_never_retry(self):
        for status, message in [(401, 'unauthorized'), (403, 'forbidden'),
                                (429, 'rate limit'), (500, 'internal'),
                                (503, 'unavailable'), (413, 'request entity too large')]:
            with self.subTest(status=status, message=message):
                self.calls.clear()
                self.api_result = subprocess.CompletedProcess(
                    [], 1, '', f'unexpected deploy status {status}: ' +
                    json.dumps({'message': message}))
                self.assertFalse(self.run_deploy()['ok'])
                self.assertEqual(len(self.calls), 1)

    def test_timeout_or_transport_error_cannot_trigger_a_second_upload(self):
        for error in [subprocess.TimeoutExpired('supabase', 1),
                      OSError('secret raw provider diagnostic')]:
            with self.subTest(error=type(error).__name__):
                self.calls.clear()
                self.api_result = error
                result = self.run_deploy()
                self.assertEqual(result['reason'], 'api_outcome_unknown_no_retry')
                self.assertEqual(len(self.calls), 1)
                self.assertNotIn('secret', json.dumps(result))

    def test_stdout_or_prefixed_duplicate_malformed_rejection_is_not_authority(self):
        self.oversize()
        exact = self.api_result.stderr
        for stderr, stdout in [('', exact), ('prefix ' + exact, ''),
                               (exact + exact, ''), (exact.replace('413:', '413x:'), ''),
                               ('unexpected deploy status 413: {bad json}', '')]:
            with self.subTest(stderr=stderr[:30]):
                self.calls.clear()
                self.api_result = subprocess.CompletedProcess([], 1, stdout, stderr)
                self.assertFalse(self.run_deploy()['ok'])
                self.assertEqual(len(self.calls), 1)

    def test_successful_cli_output_containing_error_text_does_not_redeploy(self):
        self.oversize()
        self.api_result.returncode = 0
        self.assertTrue(self.run_deploy()['ok'])
        self.assertEqual(len(self.calls), 1)

    def test_configured_or_discovered_map_cannot_use_unproved_local_path(self):
        for configured in [False, True]:
            with self.subTest(configured=configured):
                self.calls.clear()
                map_path = 'supabase/functions/paige-ai-chat/deno.json'
                self.fixture.files[map_path] = '{"imports":{}}\n'
                if configured:
                    self.fixture.files['supabase/config.toml'] += (
                        '[functions.paige-ai-chat]\nimport_map = "functions/paige-ai-chat/deno.json"\n')
                self.fixture.recommit()
                self.oversize()
                result = self.run_deploy()
                self.assertEqual(result['reason'], 'local_import_map_contract_unverified')
                self.assertEqual(len(self.calls), 1)

    def test_project_change_is_refused_before_any_cli_io(self):
        self.fixture.files['supabase/config.toml'] = 'project_id = "other-project"\n'
        self.fixture.recommit()
        self.assertEqual(self.run_deploy()['reason'], 'source_validation_refused')
        self.assertEqual(self.calls, [])

    def test_dirty_source_is_refused_before_any_cli_io(self):
        path = self.fixture.repo / 'supabase/functions/_shared/authority.ts'
        path.write_text('export const owner = "changed";\n', encoding='utf-8')
        self.assertEqual(self.run_deploy()['reason'], 'source_validation_refused')
        self.assertEqual(self.calls, [])

    def test_source_withdrawal_after_rejection_prevents_local_upload(self):
        self.oversize()
        self.after_api = lambda: (self.fixture.repo /
                                  'supabase/functions/_shared/authority.ts').unlink()
        self.assertEqual(self.run_deploy()['reason'], 'source_changed_no_retry')
        self.assertEqual(len(self.calls), 1)

    def test_docker_failure_cannot_fall_back_silently_to_api_again(self):
        self.oversize()
        self.docker_result = subprocess.CompletedProcess([], 1, '', 'secret diagnostic')
        result = self.run_deploy()
        self.assertEqual(result['reason'], 'local_builder_unavailable')
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn('secret', json.dumps(result))

    def test_local_rejection_or_uncertainty_has_no_third_upload(self):
        for value in [subprocess.CompletedProcess([], 1, '', 'secret diagnostic'),
                      subprocess.TimeoutExpired('supabase', 1)]:
            with self.subTest(value=type(value).__name__):
                self.calls.clear()
                self.oversize()
                self.local_result = value
                result = self.run_deploy()
                self.assertFalse(result['ok'])
                self.assertFalse(result['source_verified'])
                self.assertEqual(len(self.calls), 3)
                self.assertNotIn('secret', json.dumps(result))

    def test_expired_overall_deadline_performs_no_cli_io(self):
        times = iter([0, edge_deploy.MAX_SECONDS + 1])
        result = edge_deploy.deploy(
            self.fixture.repo, self.fixture.commit, 'paige-ai-chat',
            runner=self.runner, clock=lambda: next(times))
        self.assertEqual(result['reason'], 'api_outcome_unknown_no_retry')
        self.assertEqual(self.calls, [])


    def test_docker_timeout_does_not_start_the_local_upload(self):
        self.oversize()
        self.docker_result = subprocess.TimeoutExpired('docker', 1)
        self.assertEqual(self.run_deploy()['reason'], 'local_builder_unavailable')
        self.assertEqual(len(self.calls), 2)

    def test_original_false_jwt_setting_is_not_overridden_by_either_path(self):
        self.fixture.files['supabase/config.toml'] += (
            '[functions.paige-ai-chat]\nverify_jwt = false\n')
        self.fixture.recommit()
        self.assertIs(edge_deploy.checked_source(
            self.fixture.repo, self.fixture.commit, 'paige-ai-chat')[1]['verify_jwt'], False)
        self.oversize()
        self.assertTrue(self.run_deploy()['ok'])
        self.assertEqual(len(self.calls), 3)


    def test_signal_or_abnormal_exit_cannot_authorize_fallback_from_error_text(self):
        for code in [-9, 2, 137]:
            with self.subTest(code=code):
                self.calls.clear()
                self.oversize()
                self.api_result.returncode = code
                self.assertEqual(self.run_deploy()['reason'], 'api_failed_no_retry')
                self.assertEqual(len(self.calls), 1)

    def test_invalid_function_selector_is_refused_before_provider_io(self):
        result = edge_deploy.deploy(
            self.fixture.repo, self.fixture.commit, 'paige-ai-chat;unsafe',
            runner=self.runner)
        self.assertEqual(result['reason'], 'source_validation_refused')
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
