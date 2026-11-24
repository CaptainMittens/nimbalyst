# TSDoc layout: the `Args::type` form

This file holds the TypeScript form of the owner's `Args::type` docstring layout.
The source is the owner's global rule file `~/.claude/rules/docstrings.md`. That
file says: for a language with no layout file, use the same sections, order and
indents in the language's own doc comment form, and write the adaptation down in
the project's `docs/`. This file is that note. The sections, order and indents
also follow the owner's Python layout (the `python-docstrings` skill) and Rust
layout (`~/.claude/docs/rust-docstrings.md`).

Code files in this repo outside the evolution loop keep their existing style. Use
this layout for each item that a change adds or edits.

## Which items get one

Each function, method, class, interface, enum, type alias and complex constant.
Tests count too: a test gets the summary line only.

## Writing rules

- Plain words, active voice, one idea per sentence.
- Keep each line under 88 characters, indent and ` * ` included.
- Describe what the code does, not how it is built.
- Say what `null`, `undefined`, an empty list or `NaN` means when the code gives
  it a meaning.
- Allowed values: name the const or union type that holds them. If none exists,
  list them in the description.
- Change no code to suit a docstring.

## Layout

- The comment sits directly above the item, above any decorator.
- Line 1 after `/**` is ` * ` and a one-line summary that starts with a verb and
  has no full stop.
- Then one blank ` *` line, then the sections.
- Indent with spaces after ` * `, never tabs:
  - Section header (`Args:`): +0
  - Item line (`name::type`): +4 spaces
  - Description line: +8 spaces
- One blank ` *` line between sections. No blank line between items.
- An item with no arguments and no return value gets the summary line only.

## Sections

Use them in this order, and only when they have content:

1. `Args:` for functions and methods
2. `Keys:` for a const object of key-value pairs
3. `Attributes:` for an interface's or class's public fields, or an enum's members
4. `Returns:`
5. `Throws:` (the TypeScript form of Python's `Raises:`)
6. `Example:`

## Item lines

- Argument: `name::type`, with the type as the signature writes it.
- Argument with a default: `name::type(=default)`.
- Optional argument or field: `name::type(optional)`.
- List arguments in signature order.
- When the type holds `<`, `{`, `}` or `@`, put the whole item line in backticks:
  `` `rows::CoachingMessageRow[]` `` is plain, and `` `map::Map<string, number>` ``
  needs them. TSDoc reads a bare `<` as an HTML tag and a bare `{` as an inline tag,
  so the hover drops the type and the checker warns.

## Returns

- One unnamed value: the type alone on the item line, then the description at +8.
- Several named values: one `name::type` item per value, in order.
- To show a sample value, write ``For example: `["a", "b"]`.`` in the description.

## Throws

One item per error: the error name alone, then the description at +8.

## Example

The `Example:` section holds a fenced block at +0:

````text
 * Example:
 *
 * ```text
 * splitDay("2026-11-24T09:53:38.926Z") gives "2026-11-24"
 * ```
````

## One short example function

```ts
/**
 * Cuts an ISO time down to its UTC day
 *
 * Args:
 *     iso::string
 *         An ISO 8601 time, for example `2026-11-24T09:53:38.926Z`.
 *     fallback::string(=unknown)
 *         The text to return when `iso` is not a valid time.
 *
 * Returns:
 *     string
 *         The day as `YYYY-MM-DD` in UTC. The `fallback` text when `iso` is
 *         not a valid time.
 *         For example: `2026-11-24` for `2026-11-24T09:53:38.926Z`.
 */
export function utcDay(iso: string, fallback = 'unknown'): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? fallback : time.toISOString().slice(0, 10);
}
```

An interface documented this way gives each public field a `Attributes:` item and
no `/** */` line of its own:

```ts
/**
 * Holds the failure and call counts of one key on one day
 *
 * Attributes:
 *     calls::number
 *         The calls of the key's tool on that day.
 *     failures::number
 *         The failed calls of the key on that day.
 */
export interface DayCount {
  calls: number;
  failures: number;
}
```

## Doc check

`pnpm typecheck` must pass with the comments in place. The IDE hover must show
each section. The hover check needs a person at an editor and is not run by the
build.
