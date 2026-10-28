#!/usr/bin/env python3
"""Original Edge CLI deployment with one bounded, explicit-size recovery.

This does not verify a release or move edge-live. The incumbent downloaded-source
verifier remains mandatory after every acknowledged upload. No provider client,
credential loader, activation or business execution is introduced here.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'edge_deploy_readback', ROOT / '.github/scripts/edge-source-readback.py')
readback = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readback)

SIZE_MESSAGE = ('Function source code exceeds the maximum deployment size (5 MB). '
                'Reduce the size of your function and try again.')
MAX_SECONDS = 600


def rejected_for_source_size(result):
    """Only the exact vendor API rejection admits another bundling method."""
    if result.returncode != 1 or not isinstance(result.stderr, str):
        return False
    if len(result.stderr) > 1024 * 1024:
        return False
    errors = [line.strip() for line in result.stderr.splitlines()
              if 'unexpected deploy status' in line]
    if len(errors) != 1:
        return False
    match = re.fullmatch(r'unexpected deploy status 413: (\{[^\r\n]*\})', errors[0])
    if match is None:
        return False
    try:
        return json.loads(match.group(1)) == {'message': SIZE_MESSAGE}
    except (TypeError, ValueError):
        return False


def failure_diagnostic(result):
    """Closed, nonsecret observations only; NEVER authority for another upload.

    Raw stdout, stderr and vendor JSON can contain credentials or private URLs.
    An interrupted process cannot establish a trustworthy HTTP result either.
    The original strict source-size predicate alone controls local recovery.
    """
    code = result.returncode
    diagnostic = {'exit_code': code} if type(code) is int and -255 <= code <= 255 else {}
    if type(code) is not int or code != 1 or not isinstance(result.stderr, str) or len(result.stderr) > 1024 * 1024:
        return diagnostic
    lines = [line.strip() for line in result.stderr.splitlines()
             if 'unexpected deploy status' in line]
    if len(lines) != 1:
        return diagnostic
    match = re.fullmatch(r'unexpected deploy status ([45]\d{2}): (\{[^\r\n]*\})', lines[0])
    if match is None or len(match.group(2)) > 8192:
        return diagnostic
    try:
        payload = json.loads(match.group(2))
    except (TypeError, ValueError, RecursionError):
        return diagnostic
    if not isinstance(payload, dict):
        return diagnostic
    message = payload.get('message')
    category = 'other'
    if message == SIZE_MESSAGE:
        category = 'source_size'
    elif isinstance(message, str) and re.match(r'Failed to bundle function(?:[: (]|$)', message, re.I):
        category = 'compiler_rejected'
    elif message == 'Failed to retrieve function bundle':
        category = 'bundle_unavailable'
    return {**diagnostic, 'http_status': int(match.group(1)), 'category': category}


def checked_source(repo, commit, name):
    # Retain the existing certified project/config authority before provider I/O.
    baseline = readback.git(repo, 'rev-parse', '--verify',
                            'refs/tags/edge-live^{commit}').decode().strip()
    readback.changed_function_configuration(repo, baseline, commit)
    project, expected = readback.expected_release(repo, commit, [name])
    if readback.git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--',
                    'supabase/config.toml', 'supabase/functions').strip():
        raise readback.ReadbackError('dirty_deployment_source')
    return project, expected[name]


def cli(args, directory, timeout):
    # Capture, but never publish, raw CLI payloads/headers/environment/error text.
    return subprocess.run(args, cwd=directory, check=False, capture_output=True,
                          text=True, timeout=timeout)


def deploy(repo, commit, name, runner=cli, clock=time.monotonic,
           source_check=checked_source):
    deadline = clock() + MAX_SECONDS

    def result(ok, reason, mode=None, diagnostic=None):
        value = {'ok': ok, 'reason': reason, 'mode': mode,
                 'source_verified': False}
        if diagnostic is not None:
            value['diagnostic'] = diagnostic
        return value

    def invoke(args, maximum=300):
        remaining = deadline - clock()
        if remaining <= 0:
            raise subprocess.TimeoutExpired('edge-deploy', 0)
        return runner(args, repo, min(maximum, remaining))

    try:
        original = source_check(repo, commit, name)
    except (readback.ReadbackError, ValueError, UnicodeError, OSError):
        return result(False, 'source_validation_refused')
    project, expected = original
    command = ['supabase', 'functions', 'deploy', name, '--project-ref', project,
               '--workdir', str(repo)]
    try:
        api = invoke([*command, '--use-api'])
    except (OSError, subprocess.SubprocessError):
        return result(False, 'api_outcome_unknown_no_retry')
    if api.returncode == 0:
        return result(True, 'upload_acknowledged_readback_required', 'api')
    if not rejected_for_source_size(api):
        return result(False, 'api_failed_no_retry', diagnostic=failure_diagnostic(api))

    # The Docker path previously omitted a configured deno.json. Do not silently
    # drop or change a map; keep API-only delivery until that contract is proved.
    if expected['import_map'] is not None:
        return result(False, 'local_import_map_contract_unverified')
    try:
        if source_check(repo, commit, name) != original:
            return result(False, 'source_changed_no_retry')
    except (readback.ReadbackError, ValueError, UnicodeError, OSError):
        return result(False, 'source_changed_no_retry')
    try:
        docker = invoke(['docker', 'info', '--format', '{{.ServerVersion}}'], 20)
    except (OSError, subprocess.SubprocessError):
        return result(False, 'local_builder_unavailable')
    if docker.returncode != 0:
        return result(False, 'local_builder_unavailable')
    try:
        # CLI2.116: these flags are mutually exclusive. Do NOT combine
        # --use-api=false and --use-docker. No auth/map override is supplied.
        local = invoke([*command, '--use-docker'])
    except (OSError, subprocess.SubprocessError):
        return result(False, 'local_outcome_unknown_no_retry', 'local_requested')
    if local.returncode != 0:
        return result(False, 'local_failed_no_retry', 'local_requested', failure_diagnostic(local))
    # This states the requested path, not a claim about bundler internals.
    return result(True, 'upload_acknowledged_readback_required', 'local_requested')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--function', dest='name', required=True)
    args = parser.parse_args(argv)
    outcome = deploy(args.repo.resolve(), args.expected_commit, args.name)
    print(json.dumps(outcome, sort_keys=True))
    return 0 if outcome['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
