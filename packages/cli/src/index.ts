/**
 * nim — companion CLI for Nimbalyst trackers and agent interop.
 *
 * Entry point: parse argv, dispatch the noun, translate thrown CliErrors into
 * stable exit codes. All command output goes to stdout; diagnostics to stderr.
 */
import { parseArgs, flagBool } from './cli/parse.js';
import { setColorEnabled } from './cli/colors.js';
import { CliError, ExitCode } from './cli/exitCodes.js';
import { safeText } from './cli/output.js';
import { runTracker } from './commands/tracker.js';
import { runStatus } from './commands/status.js';
import { runWorkspace } from './commands/workspace.js';
import { runSession, runDoc } from './commands/sessionDoc.js';
import { runRelease } from './commands/release.js';
import { runLogin, runLogout, runWhoami } from './commands/login.js';
import { runPages, wikiRenamed } from './commands/pages.js';

export const VERSION = '0.1.0';

const PAGES_HELP = `Team pages (Nimbalyst Teams sign-in; server = NIM_SERVER, default https://sync.nimbalyst.com):
  nim login / nim logout / nim whoami
  nim pages status                           (unbound, bound, or ambiguous, with your teams)
  nim pages bind --org <id> --project <id>   (team admins: connect this repo's remote)
  nim pages create-project --org <id> --name <n> [--bind]   (team admins)
  nim pages pin --org <id> --project <id>    (writes .nimbalyst/wiki.json; one of the projects this repo resolves to)
  nim pages list                             (the page tree, with links)
  nim pages read <uri|link>
  nim pages search <query> [--limit n]       (page titles and text)
  nim pages edit <uri|link> --old TXT --new TXT [...]   (or --replacements-file F)
  nim pages create "<title>" [--parent ID] [--parent-kind page|item] [--path A/B]
                     [--body TXT | --body-file F] [--before NODE | --after NODE]
  nim pages create-folder "<name>" [--parent ID] [--path A/B]
  nim pages move <id> --kind page|item|type [--parent ID] [--path A/B]
                     [--before NODE | --after NODE] [--under-type]
  nim pages rename <pageId> "<name>"
  nim pages delete <pageId> --kind doc|folder
  nim pages set-type <pageId> <typeId>
  nim pages members [query]
  nim pages types [--search S]
  nim pages define-type [-f <schema.yaml|.json>] [--predicates-file F] [--overwrite]
                     [--remove-predicate ID ...] [--confirm-destructive]
  nim pages items [--type T] [--status S] [--search TXT] [--where f=v ...] [--include-closed] [--limit N]
  nim pages item <id|KEY>
  nim pages create-item <type> "<title>" [--status S] [--field k=v ...] [--tag T ...] [--body TXT | --body-file F]
  nim pages update-item <id|KEY> [--title T] [--status S] [--field k=v ...] [--unset f ...]
                     [--body TXT | --body-file F] [--archive | --unarchive] [--expected-revision N]
  nim pages comments --page <uri> [...] [--query TXT]   (citable comments)
  Target flags: --repo <remote> (default: origin; ignores .nimbalyst/wiki.json),
                --org <id> --project <id> (explicit project; ignores .nimbalyst/wiki.json)
`;

const help = () => `nim — Nimbalyst companion CLI (v${VERSION})

Usage:
  nim <noun> <verb> [--flags]

Nouns:
  tracker     trackers (bugs, tasks, decisions, imported records) — read in v1
  release     release items — list, finalize at build time, generate notes
  session     AI sessions (read-only in v1)
  doc         workspace documents (read-only in v1)
  workspace   list / show workspaces
  status      what nim is connected to (live or direct), schema, workspaces

Tracker (read):
  nim tracker ready  [--type T] [--limit N | --all] [--json|--csv|-q]
  nim tracker list   [--type T] [--status open|closed|<s>] [--priority P]
                     [--owner me|<o>] [--since 1d] [--until 2026-06-01]
                     [--where field=value] [--limit N | --all] [--json|--csv|-q]
                     [--inbox]                (still needs a triage decision; live mode)
  nim tracker get    <id|KEY|urn>
  nim tracker show   <id|KEY>            (pretty body render)
  nim tracker types  [show <type>]

Tracker (write — live mode; direct writes refused while the app owns the DB):
  nim tracker create <type> "<title>" [--status S] [--priority P] [--owner O]
                     [--tag T ...] [--field k=v ...] [--body TXT | --body-file F]
                     [--type-tag T ...] [--link-session]
  nim tracker update <id|KEY> [--status S] [--field k=v ...] [--unset f ...] …
  nim tracker comment <id|KEY> "<body>"   (or --body-file F)
  nim tracker archive <id|KEY> / nim tracker unarchive <id|KEY>
  nim tracker link-session <id|KEY> [--session <id>]   (live only)
  nim tracker types define -f <schema.yaml|.json> / nim tracker types rm <type>

Tracker (importers — live mode only):
  nim tracker importers                                  (list installed importers)
  nim tracker import search <providerId> [--repo owner/repo] [--state open|closed|all]
                     [--search TXT] [--limit N]
  nim tracker import <providerId> <externalId> [--type <trackerType>]
  nim tracker import resnapshot <urn>                    (e.g. github://owner/repo#42)

Release (live mode for writes):
  nim release list [--pending] [--json]
  nim release finalize [<id|KEY>] --version X.Y.Z [--tag vX.Y.Z] [--channel alpha|stable]
                     [--date <iso>]        (fills the existing item, flips it to released)
  nim release notes [<id|KEY>] [--json]    (markdown from the release's members)

${PAGES_HELP}
Cross-cutting flags:
  --workspace <path>   target workspace (default: resolve from cwd)
  --db <file>          direct mode against an explicit SQLite file
  --live / --offline   force access mode
  --json / --csv       machine output (JSON shape = TrackerRecord)
  --columns a,b,c      table/CSV columns
  --quiet, -q          ids only
  --no-color           disable ANSI color (also honors NO_COLOR)

Exit codes: 0 ok · 1 not found · 2 usage · 3 connection · 4 schema · 5 write-not-permitted
`;

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return reportError(err);
  }

  if (flagBool(args, 'no-color')) setColorEnabled(false);

  if (flagBool(args, 'version')) {
    process.stdout.write(VERSION + '\n');
    return ExitCode.OK;
  }

  if (!args.noun || flagBool(args, 'help')) {
    process.stdout.write(help());
    return ExitCode.OK;
  }

  try {
    switch (args.noun) {
      case 'tracker':
        return await runTracker(args);
      case 'release':
        return await runRelease(args);
      case 'status':
        return await runStatus(args);
      case 'workspace':
        return await runWorkspace(args);
      case 'session':
        return await runSession(args);
      case 'doc':
        return await runDoc(args);
      case 'login':
        return await runLogin(args);
      case 'logout':
        return await runLogout(args);
      case 'whoami':
        return await runWhoami(args);
      case 'pages':
        return await runPages(args);
      case 'wiki':
        return wikiRenamed();
      default:
        process.stderr.write(`nim: unknown command '${args.noun}'. Run 'nim --help'.\n`);
        return ExitCode.USAGE;
    }
  } catch (err) {
    return reportError(err);
  }
}

function reportError(err: unknown): number {
  // Messages can carry server- or team-written text; strip terminal control sequences.
  if (err instanceof CliError) {
    process.stderr.write(`nim: ${safeText(err.message)}\n`);
    return err.code;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`nim: ${safeText(message)}\n`);
  if (process.env.NIM_DEBUG && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  return ExitCode.CONNECTION;
}
