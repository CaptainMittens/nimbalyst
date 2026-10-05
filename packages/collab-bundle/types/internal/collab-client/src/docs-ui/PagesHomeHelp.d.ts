import type { CollabHost, CollabScope } from '../core/index';
/** Built-in Pages guidance. It never changes an existing Home or requires an agent/curator. */
export declare function PagesHomeHelp({ host, scope, personal }: {
    host: CollabHost;
    scope: CollabScope;
    personal?: boolean;
}): import("react").JSX.Element;
