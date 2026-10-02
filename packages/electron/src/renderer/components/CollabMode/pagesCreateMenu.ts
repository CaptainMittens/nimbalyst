/**
 * The title bar's "+" menu for Pages mode, composed from the Team and Personal
 * sidebar sections. The title bar holds one menu per mode, so the Personal
 * section's entries join the team menu rather than publishing their own.
 */

import type { CollabSidebarCreateMenu } from '@nimbalyst/collab-client/docs-ui';
import type { TitleBarCreateMenu } from '../../store/atoms/titleBarCreate';

export function composePagesCreateMenu(
  team: CollabSidebarCreateMenu | null,
  personal: CollabSidebarCreateMenu | null,
): TitleBarCreateMenu | null {
  const primary = team ?? personal;
  if (!primary) return null;
  const folderItem = (menu: CollabSidebarCreateMenu, id: string, label: string) => ({
    id,
    label,
    icon: 'create_new_folder',
    separatorBefore: true,
    onSelect: menu.onNewFolder,
  });

  if (!team) {
    return {
      mode: 'collab',
      destination: primary.destination,
      heading: { label: 'Personal', icon: 'person' },
      onPrimary: primary.onPrimary,
      primaryTrailing: primary.primaryTrailing,
      items: [...primary.items, folderItem(primary, 'folder', 'New folder')],
    };
  }

  return {
    mode: 'collab',
    destination: team.destination,
    heading: { label: 'Shared with team', icon: 'groups' },
    onPrimary: team.onPrimary,
    primaryTrailing: team.primaryTrailing,
    items: [
      ...team.items,
      folderItem(team, 'folder', 'New folder'),
      ...(personal
        ? [
          {
            id: 'personal-page',
            label: 'New personal page',
            icon: 'person',
            separatorBefore: true,
            trailing: personal.primaryTrailing,
            onSelect: personal.onPrimary,
          },
          { ...folderItem(personal, 'personal-folder', 'New personal folder'), separatorBefore: false },
        ]
        : []),
    ],
  };
}
