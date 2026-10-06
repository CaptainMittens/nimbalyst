import { type ReactNode } from 'react';
import type { LexicalEditor } from 'lexical';
import type { CollabOpenOptions } from '../../core';
import { type PlacedViewScope } from '../../../../runtime/src/core/placedViewUrl';
import type { PlacedViewHandoff } from './placedViewHandoff';
export declare function TypePageViews({ typeId, editor, temporaryView, onClearTemporaryView, onPrepareDocument, scope, onOpenItem, children }: {
    typeId: string;
    editor?: LexicalEditor | null;
    temporaryView?: PlacedViewHandoff | null;
    onClearTemporaryView?: () => void;
    onPrepareDocument?: () => Promise<void>;
    scope?: PlacedViewScope;
    onOpenItem: (id: string, options?: CollabOpenOptions) => void;
    children: ReactNode;
}): import("react").JSX.Element;
