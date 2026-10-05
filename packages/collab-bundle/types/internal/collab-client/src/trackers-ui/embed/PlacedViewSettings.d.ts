import type { TrackerFilterField } from '../trackerFilterFields';
export interface PlacedViewSettingsProps {
    attrs: Readonly<Record<string, string>>;
    fields: readonly TrackerFilterField[];
    temporary: boolean;
    defaultColumns?: readonly string[];
    onChange(patch: Readonly<Record<string, string | null>>): void;
}
/** Settings edit only the keys touched by the current gesture. */
export declare function PlacedViewSettings({ attrs, fields, temporary, onChange, defaultColumns }: PlacedViewSettingsProps): import("react").JSX.Element;
