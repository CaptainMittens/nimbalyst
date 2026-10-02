import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findNativeDialogCalls } from '../check-native-dialogs.mjs';

test('flags global dialog calls and ignores comments, strings, and local helpers named confirm', () => {
  const flagged = `window.confirm('a'); alert('b'); globalThis.prompt('c');`;
  assert.deepEqual(findNativeDialogCalls(flagged, 'a.ts').map(hit => hit.call), ['window.confirm', 'alert', 'globalThis.prompt']);
  const clean = `// window.confirm('x')\nconst s = "alert(1)";\nconst { confirm } = useDialog();\nawait confirm({ title: 't' });\ndialogRef.current.confirm({});`;
  assert.deepEqual(findNativeDialogCalls(clean, 'b.tsx'), []);
});
