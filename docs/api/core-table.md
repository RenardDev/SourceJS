# `require("core/table")`

> Warning: This API reference is large for AI-agent processing. Use the table of contents to navigate directly to the
> relevant section.

> This page is maintained by hand. Examples build console-ready tables from SourceJS runtime data.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`ASCIITable`](#asciitable)
- [`Column`](#column)
- [`Item`](#item)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/table.js`](../../packages/sourcejs/core/table.js). It provides fixed-alignment
text items, array-backed columns, and a table formatter for console-ready diagnostic output. Use it when runtime records need a
predictable plain-text layout without terminal-specific rendering.

## Import

```js
const { ASCIITable, Alignment, Column, Item } = require("core/table");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name, `"core/table"`. |
| [`ASCIITable`](#asciitable-1) | Class | `new ASCIITable(...vecColumns)`; requires at least one column. |
| [`Alignment`](#alignment) | Frozen object | `CENTER = "center"`, `LEFT = "left"`, and `RIGHT = "right"`. |
| [`Column`](#column-1) | Class | `new Column(NameSource, AlignmentValue = Alignment.CENTER, unLeftPadding = 2, unRightPadding = 2)` |
| [`Item`](#item-1) | Class | `new Item(ValueSource, AlignmentValue = Alignment.LEFT)` |

## `ASCIITable`

| Member | Signature |
| --- | --- |
| `Columns` | Live array of `Column` instances. |
| `Length` | Read-only number of columns. |
| `[Symbol.iterator]` | Iterates over columns. |
| [`GetTableColumn`](#asciitablegettablecolumn) | `GetTableColumn(unIndex)`; zero-based lookup, returns `undefined` for a missing index. |
| [`AddTableRow`](#asciitableaddtablerow) | `AddTableRow(...vecItems)`; item count must equal column count. |
| [`FormatTable`](#asciitableformattable) | `FormatTable(strHeaderSeparator = "=", strColumnSeparator = "|")` |

## `Column`

| Member | Signature |
| --- | --- |
| `Name` | Header `Item`. |
| `LeftPadding` | Spaces before header and row values. |
| `RightPadding` | Spaces after header and row values. |
| `length` | Number of row items inherited from `Array`. |
| `[Symbol.species]` | Returns `Array`; species-aware methods such as `map()` and `filter()` create plain arrays. |
| [`GetMaximumContentWidth`](#columngetmaximumcontentwidth) | `GetMaximumContentWidth()`; maximum header/item length, excluding padding. |
| [`FormatColumn`](#columnformatcolumn) | `FormatColumn()`; returns `{ Header, Rows }` with a formatted header string and an array of formatted row strings. |

## `Item`

| Member | Signature |
| --- | --- |
| `Value` | String representation of the source value. |
| `Alignment` | One of the string values in `Alignment`. |
| `Length` | Read-only text length in UTF-16 code units, not terminal display columns. |
| [`FormatItem`](#itemformatitem) | `FormatItem(unWidth, unLeftPadding, unRightPadding)` |

## Examples

### `ASCIITable`

```js
const { ASCIITable, Alignment, Column, Item } = require("core/table");
const { GetPluginRecords } = require("plugins");

const g_PluginTable = new ASCIITable(new Column("Plugin", Alignment.LEFT), new Column("Entry", Alignment.LEFT), new Column("Index", Alignment.RIGHT));

for (const PluginRecord of GetPluginRecords()) {
	g_PluginTable.AddTableRow(PluginRecord.Name, PluginRecord.Entry, new Item(PluginRecord.Index, Alignment.RIGHT));
}

console.log(g_PluginTable.FormatTable());
```

### `Alignment`

```js
const { Alignment, Item } = require("core/table");

const g_strLeftAlignedText = new Item("plugin", Alignment.LEFT).FormatItem(10, 0, 0);
const g_strCenterAlignedText = new Item("loaded", Alignment.CENTER).FormatItem(10, 0, 0);
const g_strRightAlignedText = new Item("3", Alignment.RIGHT).FormatItem(10, 0, 0);

console.log({ CenterAlignedText: g_strCenterAlignedText, LeftAlignedText: g_strLeftAlignedText, RightAlignedText: g_strRightAlignedText });
```

### `Column`

```js
const { Alignment, Column, Item } = require("core/table");

const g_vecStatusColumn = new Column("Status", Alignment.CENTER, 1, 1);
g_vecStatusColumn.push(new Item("loaded", Alignment.CENTER));
g_vecStatusColumn.push(new Item("disabled", Alignment.CENTER));

const g_StatusColumnState = {
	Header: g_vecStatusColumn.Name.Value,
	LeftPadding: g_vecStatusColumn.LeftPadding,
	RightPadding: g_vecStatusColumn.RightPadding,
	RowCount: g_vecStatusColumn.length,
};
console.log(g_StatusColumnState);
```

### `Item`

```js
const { Alignment, Item } = require("core/table");

const g_ScoreItem = new Item(42, Alignment.RIGHT);
const g_ScoreItemState = { Value: g_ScoreItem.Value, Alignment: g_ScoreItem.Alignment, Length: g_ScoreItem.Length };
console.log(g_ScoreItemState);
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/table");

console.log(`ASCII table helpers: ${MODULE_NAME}`);
```

### `ASCIITable.AddTableRow`

```js
const { ASCIITable } = require("core/table");

const g_PluginTable = new ASCIITable("Plugin", "State");
g_PluginTable.AddTableRow("hello", "loaded").AddTableRow("match-stats", "loaded");

console.log(g_PluginTable.FormatTable());
```

### `ASCIITable.GetTableColumn`

```js
const { ASCIITable } = require("core/table");

const g_PluginTable = new ASCIITable("Plugin", "State");
g_PluginTable.AddTableRow("hello", "loaded");

const g_vecPluginColumn = g_PluginTable.GetTableColumn(0);
if (!g_vecPluginColumn) {
	throw new Error("The plugin table has no first column.");
}

console.log(`First plugin: ${g_vecPluginColumn[0].Value}`);
```

### `ASCIITable.FormatTable`

```js
const { ASCIITable } = require("core/table");

const g_PluginTable = new ASCIITable("Plugin", "State");
g_PluginTable.AddTableRow("hello", "loaded");

const g_strFormattedTable = g_PluginTable.FormatTable("-", "+");
console.log(g_strFormattedTable);
```

### `ASCIITable` state and iteration

```js
const { ASCIITable } = require("core/table");

const g_PluginTable = new ASCIITable("Plugin", "State", "Index");
const g_vecPluginColumns = g_PluginTable.Columns;

g_PluginTable.AddTableRow("hello", "loaded", 1);

console.log(`Column count: ${g_PluginTable.Length}`);

for (const vecPluginColumn of g_PluginTable) {
	console.log(vecPluginColumn.Name.Value);
}

console.log(`Rows in the live first column: ${g_vecPluginColumns[0].length}`);
```

### `Column.FormatColumn`

```js
const { Alignment, Column, Item } = require("core/table");

const g_vecPluginColumn = new Column("Plugin", Alignment.LEFT, 1, 1);
g_vecPluginColumn.push(new Item("hello"));
g_vecPluginColumn.push(new Item("match-stats"));

const g_FormattedPluginColumn = g_vecPluginColumn.FormatColumn();
console.log(g_FormattedPluginColumn.Header);
console.log(g_FormattedPluginColumn.Rows.join("\n"));
```

### `Column.GetMaximumContentWidth`

```js
const { Column, Item } = require("core/table");

const g_vecPluginColumn = new Column("Plugin");
g_vecPluginColumn.push(new Item("hello"));
g_vecPluginColumn.push(new Item("match-stats"));

console.log(`Content width: ${g_vecPluginColumn.GetMaximumContentWidth()}`);
```

### `Item.FormatItem`

```js
const { Alignment, Item } = require("core/table");

const g_IndexItem = new Item(7, Alignment.RIGHT);
const g_strFormattedIndex = g_IndexItem.FormatItem(4, 1, 1);
console.log(`|${g_strFormattedIndex}|`);
```

## Safe use

- Construct `ASCIITable` with at least one column. Plain column values are converted to `Column` instances.
- Add exactly one row value per column. `AddTableRow()` converts plain values to `Item` instances before appending and returns
  the table for chaining. On a failed append it attempts to pop earlier successful appends. Overridden array methods, proxies,
  or a failing rollback can leave partial changes; do not treat this as an unconditional transaction guarantee.
- Check `GetTableColumn()` before dereferencing it. An out-of-range index returns `undefined`.
- `Column` extends `Array`, but its width and formatting methods expect every row element to be an `Item`. Do not push arbitrary
  objects into a column.
- A column's alignment controls its header, not later row items. Plain row values use `Alignment.LEFT`; pass an explicitly aligned
  `Item` when a cell needs another alignment.
- Column names, item values, and alignment values are converted with `String()`. Use the frozen `Alignment` values; alignment
  strings are normalized case-insensitively, and unknown values throw `TypeError`.
- Text width uses UTF-16 code units, not terminal display columns, and text is not escaped or sanitized. Newlines, control
  characters, combining marks, and wide characters can disrupt the layout.
- `FormatTable()` requires header and column separator strings of exactly one UTF-16 code unit. When calling `Item.FormatItem()`
  directly, pass the containing `Column.GetMaximumContentWidth()` so centered text is not assigned less than its content width.

## Related files

- [`packages/sourcejs/core/table.js`](../../packages/sourcejs/core/table.js) — table classes, alignment normalization, and text
  formatting.
- [`core-command.md`](core-command.md) — command output that can consume formatted tables.
- [`plugins.md`](plugins.md) — plugin records used by the table examples.
