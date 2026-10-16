#!/usr/bin/env python3
"""Verify the existing selected Edge release before advancing edge-live.

Uses only the release CLI's existing authentication. Downloads never touch the
checkout. This is source identity, not a business-action/worker-cessation proof.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
MAX_ATTEMPTS = 3
MAX_SECONDS = 600
RETRY_SECONDS = 5


class ReadbackError(Exception):
    """Only fixed reason codes leave the verifier; CLI payloads may be sensitive."""


def normalized(data):
    # Same normalization as the incumbent archived-source comparisons: normalize
    # CRLF and retain one terminal LF (do not trim other whitespace/newlines).
    return (data.decode('utf-8').replace('\r\n', '\n').removesuffix('\n') + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(normalized(data)).hexdigest()


def git(repo, *args):
    try:
        return subprocess.run(['git', '-C', str(repo), *args], check=True,
                              capture_output=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError) as error:
        raise ReadbackError('immutable_source_unavailable') from error


def commit_file(repo, commit, relative):
    content = git(repo, 'show', f'{commit}:{relative}')
    path = repo / relative
    if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
        # Compare normalized text because Windows checkouts may have CRLF.
        if not path.is_file() or path.is_symlink() or digest(path.read_bytes()) != digest(content):
            raise ReadbackError('checkout_differs_from_commit')
    return content


def changed_function_configuration(repo, before, commit):
    """Supplement the incumbent source graph with only changed function options."""
    if (not re.fullmatch(r'[0-9a-f]{40}', before or '') or
            not re.fullmatch(r'[0-9a-f]{40}', commit) or
            git(repo, 'rev-parse', 'HEAD').decode().strip() != commit):
        raise ReadbackError('invalid_configuration_baseline')
    previous = tomllib.loads(git(repo, 'show', f'{before}:supabase/config.toml').decode('utf-8'))
    current = tomllib.loads(commit_file(repo, commit, 'supabase/config.toml').decode('utf-8'))
    for config in (previous, current):
        if not isinstance(config.get('project_id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', config['project_id']):
            raise ReadbackError('invalid_project_configuration')
    if previous['project_id'] != current['project_id']:
        # A tag certified for one project is no evidence about another project.
        # Do not turn this into an implicit all-function migration/deployment.
        raise ReadbackError('project_change_requires_separate_release')
    old_options, new_options = previous.get('functions', {}), current.get('functions', {})
    if not isinstance(old_options, dict) or not isinstance(new_options, dict):
        raise ReadbackError('invalid_function_configuration')
    directories = {}
    for revision in (before, commit):
        directories[revision] = set(git(repo, 'ls-tree', '-d', '--name-only',
                                       f'{revision}:supabase/functions').decode().splitlines())
    changed = set()
    for name in old_options.keys() | new_options.keys():
        if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', name) or
                not isinstance(old_options.get(name, {}), dict) or
                not isinstance(new_options.get(name, {}), dict)):
            raise ReadbackError('invalid_function_configuration')
        if old_options.get(name, {}) == new_options.get(name, {}):
            continue
        if name in directories[commit]:
            if new_options.get(name, {}).get('enabled', True) is not True:
                raise ReadbackError('disabled_function_requires_separate_release')
            changed.add(name)
        elif name not in directories[before]:
            raise ReadbackError('configuration_function_source_missing')
        # A removed source directory follows the incumbent retired-functions path.
        # It must never be reintroduced into the deploy/readback set.
    return changed


def configuration_selection(repo, before, commit, names, require_coverage=False):
    if len(names) != len(set(names)) or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', n) for n in names):
        raise ReadbackError('invalid_selected_functions')
    changed = changed_function_configuration(repo, before, commit)
    if require_coverage and not changed.issubset(names):
        raise ReadbackError('function_configuration_not_verified')
    return sorted(set(names) | changed)


def runtime_closure(graph, entry):
    # Keep the incumbent graph and resolver, but do not require files reachable
    # solely through explicit erased declarations. The anchored, restricted
    # clause cannot span a semicolon/string into a later runtime import. All
    # ambiguous syntax and comment lookalikes remain conservative requirements.
    type_declaration = re.compile(
        r'''(?m)^[ \t]*(?:import|export)\s+type\s+'''
        r'''(?:[A-Za-z_$][\w$]*|\{[^{};'"`]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)'''
        r'''\s+from\s*(['"])[^'"\r\n]+\1''')
    cache, pending = {}, [entry]
    while pending:
        filename = pending.pop()
        if filename in cache:
            continue
        source = Path(filename).read_text(encoding='utf-8')
        erased = [(match.start(), match.end()) for match in type_declaration.finditer(source)]
        dependencies = []
        for match in graph.IMPORT_RE.finditer(source):
            if any(start <= match.start() < end for start, end in erased):
                continue
            resolved = graph.resolve_specifier(filename, match.group(1))
            if resolved:
                dependencies.append(resolved)
        cache[filename] = dependencies
        pending.extend(dependencies)
    return graph.bundle_closure([entry], cache)


def expected_release(repo, commit, names):
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != commit:
        raise ReadbackError('wrong_checkout_commit')
    if not names or len(names) != len(set(names)) or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', n) for n in names):
        raise ReadbackError('invalid_selected_functions')
    config = tomllib.loads(commit_file(repo, commit, 'supabase/config.toml').decode('utf-8'))
    project = config.get('project_id')
    if not isinstance(project, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', project):
        raise ReadbackError('invalid_project_configuration')
    graph_path = ROOT / '.github/scripts/edge-affected.py'
    spec = importlib.util.spec_from_file_location('incumbent_edge_graph', graph_path)
    graph = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(graph)
    expected = {}
    for name in names:
        options = config.get('functions', {}).get(name, {})
        entry = (repo / 'supabase' / options.get('entrypoint', f'functions/{name}/index.ts')).resolve()
        functions_root = (repo / 'supabase/functions').resolve()
        if not entry.is_relative_to(functions_root) or not entry.is_file():
            raise ReadbackError('invalid_local_entrypoint')
        # The pinned downloader flattens an entrypoint into the slug directory.
        # Current configured entrypoints already live there; refuse an unknown
        # layout instead of comparing a silently shifted dependency tree.
        if entry.parent != functions_root / name:
            raise ReadbackError('unsupported_local_entrypoint_layout')
        jwt = options.get('verify_jwt', True)
        if not isinstance(jwt, bool):
            raise ReadbackError('invalid_jwt_configuration')
        if options.get('static_files'):
            raise ReadbackError('unsupported_static_file_proof')
        closure = runtime_closure(graph, str(entry))
        import_map = options.get('import_map')
        if import_map is None:
            # Pinned CLI's normal discovery order, then its deprecated fallback.
            discovered = [entry.parent / n for n in ('deno.json', 'deno.jsonc', 'import_map.json')]
            discovered.append(functions_root / 'import_map.json')
            map_path = next((p for p in discovered if p.is_file()), None)
        else:
            map_path = (repo / 'supabase' / import_map).resolve()
        if map_path is not None:
            if not map_path.is_relative_to(functions_root) or not map_path.is_file():
                raise ReadbackError('invalid_local_import_map')
            # Explicit import-map bytes must be included in source identity.
            # External dependencies are outside the existing local-source proof.
            try:
                aliases = json.loads(commit_file(repo, commit, map_path.relative_to(repo).as_posix()))
            except ValueError as error:
                raise ReadbackError('unsupported_import_map_format') from error
            if not isinstance(aliases, dict) or not isinstance(aliases.get('imports', {}), dict) or not isinstance(aliases.get('scopes', {}), dict):
                raise ReadbackError('invalid_local_import_map')
            if aliases.get('importMap'):
                raise ReadbackError('unsupported_nested_import_map')
            if any(not isinstance(scope, dict) for scope in aliases.get('scopes', {}).values()):
                raise ReadbackError('invalid_local_import_map')
            mappings = list(aliases.get('imports', {}).values())
            mappings += [target for scope in aliases.get('scopes', {}).values() for target in scope.values()]
            if any(isinstance(target, str) and (target.startswith('file:') or not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target)) for target in mappings):
                raise ReadbackError('unsupported_local_import_alias')
            closure.add(str(map_path))
        files = {}
        for filename in sorted(closure):
            path = Path(filename).resolve()
            if not path.is_relative_to(functions_root):
                raise ReadbackError('unsupported_local_source_root')
            relative = path.relative_to(repo).as_posix()
            files[relative] = digest(commit_file(repo, commit, relative))
        expected[name] = {'entrypoint': entry.relative_to(repo).as_posix(),
                          'import_map': map_path.relative_to(repo).as_posix() if map_path is not None else None,
                          'verify_jwt': jwt, 'files': files}
    return project, expected


def entrypoint_matches(raw, expected):
    if not isinstance(raw, str) or not raw:
        return False
    parsed = urlsplit(raw)
    if parsed.scheme not in ('', 'file') or parsed.netloc or parsed.query or parsed.fragment:
        return False
    path = unquote(parsed.path).replace('\\', '/')
    parts = path.split('/')
    return '..' not in parts and (path == expected or path.endswith('/' + expected))


def metadata_for(rows, name, expected):
    matching = [row for row in rows if isinstance(row, dict) and row.get('slug') == name]
    if len(matching) != 1:
        raise ReadbackError('missing_or_duplicate_metadata')
    row = matching[0]
    if row.get('status') != 'ACTIVE':
        raise ReadbackError('function_not_active')
    if row.get('verify_jwt') is not expected['verify_jwt']:
        raise ReadbackError('jwt_configuration_mismatch')
    if not entrypoint_matches(row.get('entrypoint_path'), expected['entrypoint']):
        raise ReadbackError('entrypoint_mismatch')
    if expected['import_map'] is not None and not entrypoint_matches(row.get('import_map_path'), expected['import_map']):
        raise ReadbackError('import_map_mismatch')
    if expected['import_map'] is None and row.get('import_map_path') not in (None, ''):
        raise ReadbackError('unexpected_import_map')
    if not isinstance(row.get('id'), str) or not row['id'] or type(row.get('version')) is not int or row['version'] < 1:
        raise ReadbackError('invalid_function_identity')
    if row.get('ezbr_sha256') is not None and (not isinstance(row['ezbr_sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['ezbr_sha256'])):
        raise ReadbackError('invalid_archive_identity')
    # Retain identity for the before/after race check; no version-increase rule.
    return {key: row.get(key) for key in ('id', 'slug', 'status', 'version', 'verify_jwt', 'entrypoint_path', 'import_map_path', 'ezbr_sha256')}


def downloaded_manifest(repo, commit, directory, expected):
    root = directory / 'supabase/functions'
    if not root.is_dir() or root.is_symlink():
        raise ReadbackError('download_missing_source')
    actual = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ReadbackError('unsafe_download_path')
        if path.is_file():
            relative = 'supabase/functions/' + path.relative_to(root).as_posix()
            actual[relative] = digest(path.read_bytes())
            # Check every downloaded local file, not only the expected subset.
            if digest(commit_file(repo, commit, relative)) != actual[relative]:
                raise ReadbackError('deployed_source_mismatch')
    if not set(expected['files']).issubset(actual):
        raise ReadbackError('download_missing_dependency')
    if any(actual[p] != sha for p, sha in expected['files'].items()):
        raise ReadbackError('deployed_source_mismatch')
    return actual


def cli(args, directory, timeout):
    try:
        return subprocess.run(['supabase', *args, '--workdir', str(directory)], cwd=directory,
                              check=True, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError) as error:
        # Never forward stdout/stderr, exception text, environment, or headers.
        raise ReadbackError('cli_readback_failed') from error


def verify(repo, commit, names, runner=cli, sleeper=time.sleep, clock=time.monotonic):
    project, expected = expected_release(repo, commit, names)
    deadline = clock() + MAX_SECONDS
    results = {name: {'function': name, 'status': 'FAIL', 'reason': 'not_verified', 'attempts': 0} for name in names}
    identities = {}

    def invoke(args, directory):
        remaining = deadline - clock()
        if remaining <= 0:
            raise ReadbackError('verification_budget_exhausted')
        return runner([*args, '--project-ref', project], directory, min(60, remaining))

    def listing(directory):
        try:
            rows = json.loads(invoke(['functions', 'list', '-o', 'json'], directory))
            if not isinstance(rows, list):
                raise ValueError('not an array')
            return rows
        except (ValueError, TypeError) as error:
            raise ReadbackError('invalid_metadata_response') from error

    with tempfile.TemporaryDirectory(prefix='paige-edge-readback-') as temporary:
        isolated = Path(temporary)
        # Minimal nonsecret config; never copy auth state or overwrite checkout.
        (isolated / 'supabase').mkdir()
        (isolated / 'supabase/config.toml').write_text(f'project_id = "{project}"\n', encoding='utf-8')
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                before = listing(isolated)
                candidates = {}
                for name in names:
                    try:
                        identity = metadata_for(before, name, expected[name])
                        if identities.get(name) == identity and results[name]['status'] == 'PASS':
                            candidates[name] = identity
                            continue
                        results[name] = {'function': name, 'status': 'FAIL', 'reason': 'not_verified', 'attempts': attempt}
                        directory = isolated / f'attempt-{attempt}' / name
                        (directory / 'supabase').mkdir(parents=True)
                        (directory / 'supabase/config.toml').write_text(f'project_id = "{project}"\n', encoding='utf-8')
                        invoke(['functions', 'download', name, '--use-api'], directory)
                        manifest = downloaded_manifest(repo, commit, directory, expected[name])
                        results[name] = {'function': name, 'status': 'PASS', 'attempts': attempt,
                                         'version': identity['version'], 'verify_jwt': identity['verify_jwt'],
                                         'entrypoint': expected[name]['entrypoint'],
                                         'archive_sha256': identity.get('ezbr_sha256'),
                                         'files': manifest,
                                         'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()}
                        candidates[name] = identity
                    except (ReadbackError, UnicodeError, OSError) as error:
                        identities.pop(name, None)
                        reason = str(error) if isinstance(error, ReadbackError) else 'invalid_download_source'
                        results[name] = {'function': name, 'status': 'FAIL', 'reason': reason, 'attempts': attempt}
                after = listing(isolated)
                for name, identity in candidates.items():
                    try:
                        if metadata_for(after, name, expected[name]) != identity:
                            raise ReadbackError('deployment_changed_during_readback')
                        identities[name] = identity
                    except ReadbackError as error:
                        identities.pop(name, None)
                        results[name] = {'function': name, 'status': 'FAIL', 'reason': str(error), 'attempts': attempt}
            except ReadbackError as error:
                # A failed final observation cannot certify even earlier matches.
                identities.clear()
                for name in names:
                    results[name] = {'function': name, 'status': 'FAIL', 'reason': str(error), 'attempts': attempt}
            if all(row['status'] == 'PASS' for row in results.values()):
                break
            if attempt < MAX_ATTEMPTS and clock() + RETRY_SECONDS < deadline:
                sleeper(RETRY_SECONDS)
            elif clock() >= deadline:
                break
    return {'commit': commit, 'selected': names, 'all_pass': all(r['status'] == 'PASS' for r in results.values()),
            'normalization': 'UTF-8; CRLF to LF; retain one terminal LF',
            'proof_boundary': 'Selected deployed source/configuration only; not business execution or customer acceptance',
            'functions': list(results.values())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--functions', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--baseline-commit')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--select-config', action='store_true')
    modes.add_argument('--require-config-coverage', action='store_true')
    args = parser.parse_args(argv)
    if args.select_config or args.require_config_coverage:
        try:
            names = args.functions.read_text(encoding='utf-8').splitlines()
            selected = configuration_selection(args.repo.resolve(), args.baseline_commit, args.expected_commit,
                                               names, args.require_config_coverage)
            if args.select_config:
                args.functions.write_text(''.join(name + '\n' for name in selected), encoding='utf-8')
            return 0
        except (ReadbackError, ValueError, OSError) as error:
            reason = str(error) if isinstance(error, ReadbackError) else 'invalid_configuration_input'
            print(f'::error::Edge configuration coverage refused: {reason}')
            return 1
    if args.report is None:
        parser.error('--report is required for deployed-source verification')
    try:
        names = args.functions.read_text(encoding='utf-8').splitlines()
        report = verify(args.repo.resolve(), args.expected_commit, names)
    except (ReadbackError, ValueError, OSError) as error:
        report = {'commit': args.expected_commit, 'all_pass': False,
                  'reason': str(error) if isinstance(error, ReadbackError) else 'invalid_readback_input'}
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for row in report.get('functions', []):
        print(f"{row['function']}: {row['status']} ({row.get('reason', 'source/configuration matched')})")
    if not report['all_pass']:
        print('::error::Deployed-source identity is unverified; edge-live must not advance.')
    return 0 if report['all_pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
