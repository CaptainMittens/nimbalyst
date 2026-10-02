/**
 * Pages mode's left sidebar: the Team section over the Personal section, each
 * a `CollabSidebar` bound to its own docs session. With no team scope the
 * Personal section stands alone under a one-line note.
 */

import React, { useState } from 'react';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import { CollabSidebar, type CollabSidebarCreateMenu } from '@nimbalyst/collab-client/docs-ui';
import {
  getElectronCollabDocsSession,
  getPersonalCollabDocsSession,
  type SharedDocument,
} from '../../store/atoms/collabDocuments';
import { ElectronCollabDocsUIRoot } from './ElectronCollabDocsUIProvider';
import { useCollabTypeResolver } from './useCollabTypeResolver';
import { SetPageTypeDialog } from './SetPageTypeDialog';
import type { PageTypeLane } from './setPageType';
import { useSetPageType } from './useSetPageType';

interface PagesSidebarSectionsProps {
  workspacePath: string;
  teamScope: CollabScope | null;
  personalScope: CollabScope;
  activeTeamDocumentId: string | null;
  activePersonalDocumentId: string | null;
  onShowHome: () => void;
  homeActive: boolean;
  registerTeamCreateMenu: (menu: CollabSidebarCreateMenu | null) => void;
  registerPersonalCreateMenu: (menu: CollabSidebarCreateMenu | null) => void;
}

export function PagesSidebarSections({
  workspacePath,
  teamScope,
  personalScope,
  activeTeamDocumentId,
  activePersonalDocumentId,
  onShowHome,
  homeActive,
  registerTeamCreateMenu,
  registerPersonalCreateMenu,
}: PagesSidebarSectionsProps) {
  const teamTypeResolver = useCollabTypeResolver('team');
  const personalTypeResolver = useCollabTypeResolver('personal');
  const setPageType = useSetPageType(workspacePath, teamScope);
  const [typingPage, setTypingPage] = useState<{ lane: PageTypeLane; page: SharedDocument } | null>(null);

  const pickType = (typeId: string) => {
    if (!typingPage) return;
    const { lane, page } = typingPage;
    const session = lane === 'personal'
      ? getPersonalCollabDocsSession(workspacePath)
      : teamScope ? getElectronCollabDocsSession(teamScope) : null;
    if (!session) return;
    void setPageType.run(lane, session, page, typeId)
      .finally(() => setTypingPage(null));
  };

  return (
    <div className="pages-sidebar-sections flex flex-col h-full min-h-0">
      {teamScope ? (
        <div className="pages-sidebar-team-section flex-1 min-h-0">
          {/* No Feedback action here any more: the request list is an
              organization surface, not a shared-docs one, and it moved beside
              the Inbox in Org mode (#3704). A document's own feedback still
              reaches it through the per-artifact backlinks. */}
          <ElectronCollabDocsUIRoot scope={teamScope}>
            <CollabSidebar
              sectionTitle="Team"
              activeDocumentId={activeTeamDocumentId}
              onShowHome={onShowHome}
              homeActive={homeActive}
              registerCreateMenu={registerTeamCreateMenu}
              typeResolver={teamTypeResolver}
              onSetPageType={(page) => setTypingPage({ lane: 'team', page })}
            />
          </ElectronCollabDocsUIRoot>
        </div>
      ) : (
        <div
          className="pages-sidebar-team-note px-3 py-2 text-xs text-nim-faint bg-nim-secondary border-r border-b border-nim shrink-0"
          data-testid="pages-sidebar-team-note"
        >
          Sign in and share this project to see team pages
        </div>
      )}
      <div className="pages-sidebar-personal-section flex-1 min-h-0">
        <ElectronCollabDocsUIRoot scope={personalScope}>
          <CollabSidebar
            sectionTitle="Personal"
            activeDocumentId={activePersonalDocumentId}
            registerCreateMenu={registerPersonalCreateMenu}
            typeResolver={personalTypeResolver}
            onSetPageType={(page) => setTypingPage({ lane: 'personal', page })}
          />
        </ElectronCollabDocsUIRoot>
      </div>
      {typingPage && (
        <SetPageTypeDialog
          pageTitle={typingPage.page.title}
          resolver={typingPage.lane === 'team' ? teamTypeResolver : personalTypeResolver}
          running={setPageType.running}
          onPick={pickType}
          onClose={() => setTypingPage(null)}
        />
      )}
    </div>
  );
}
