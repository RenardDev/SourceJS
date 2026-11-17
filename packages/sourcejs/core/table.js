"use strict";

const g_strModuleName = "core/table";
const g_unDefaultColumnPadding = 2;

// Preserve the documented case-insensitive public alignment strings.
const g_Alignment = Object.freeze({
	CENTER: "center",
	LEFT: "left",
	RIGHT: "right",
});

function NormalizeAlignment(AlignmentValue) {
	const strAlignmentText = String(AlignmentValue);
	const strNormalizedAlignment = strAlignmentText.toLowerCase();
	if ((strNormalizedAlignment !== g_Alignment.CENTER) && (strNormalizedAlignment !== g_Alignment.LEFT) && (strNormalizedAlignment !== g_Alignment.RIGHT)) {
		throw new TypeError(`Unknown table alignment: ${strAlignmentText}`);
	}

	return strNormalizedAlignment;
}

function AlignText(strText, unColumnWidth, strAlignment) {
	const strNormalizedAlignment = NormalizeAlignment(strAlignment);
	if (strNormalizedAlignment === g_Alignment.RIGHT) {
		return strText.padStart(unColumnWidth, " ");
	}

	if (strNormalizedAlignment === g_Alignment.CENTER) {
		const unTotalPadding = unColumnWidth - strText.length;
		const unLeftPadding = Math.floor(unTotalPadding / 2);
		const unRightPadding = unTotalPadding - unLeftPadding;
		return `${" ".repeat(unLeftPadding)}${strText}${" ".repeat(unRightPadding)}`;
	}

	return strText.padEnd(unColumnWidth, " ");
}

class Item {
	constructor(ValueSource, AlignmentValue = g_Alignment.LEFT) {
		const strValue = String(ValueSource);
		const strNormalizedAlignment = NormalizeAlignment(AlignmentValue);
		this.m_strValue = strValue;
		this.m_strAlignment = strNormalizedAlignment;
	}

	FormatItem(unWidth, unLeftPadding, unRightPadding) {
		return `${" ".repeat(unLeftPadding)}${AlignText(this.m_strValue, unWidth, this.m_strAlignment)}${" ".repeat(unRightPadding)}`;
	}

	get Value() {
		return this.m_strValue;
	}

	get Alignment() {
		return this.m_strAlignment;
	}

	get Length() {
		return this.m_strValue.length;
	}
}

class Column extends Array {
	constructor(NameSource, AlignmentValue = g_Alignment.CENTER, unLeftPadding = g_unDefaultColumnPadding, unRightPadding = g_unDefaultColumnPadding) {
		super();

		const Header = new Item(NameSource, AlignmentValue);
		this.m_Name = Header;
		this.m_unLeftPadding = unLeftPadding;
		this.m_unRightPadding = unRightPadding;
	}

	GetMaximumContentWidth() {
		let unMaximumContentWidth = this.m_Name.Length;
		for (const ItemValue of this) {
			unMaximumContentWidth = Math.max(unMaximumContentWidth, ItemValue.Length);
		}

		return unMaximumContentWidth;
	}

	FormatColumn() {
		const unContentWidth = this.GetMaximumContentWidth();
		const Header = this.m_Name;
		const unLeftPadding = this.m_unLeftPadding;
		const unRightPadding = this.m_unRightPadding;
		const strFormattedHeader = Header.FormatItem(unContentWidth, unLeftPadding, unRightPadding);
		const FormatItem = (ItemValue) => ItemValue.FormatItem(unContentWidth, unLeftPadding, unRightPadding);
		const vecFormattedRows = Array.from(this, FormatItem);

		return { Header: strFormattedHeader, Rows: vecFormattedRows };
	}

	get Name() {
		return this.m_Name;
	}

	get LeftPadding() {
		return this.m_unLeftPadding;
	}

	get RightPadding() {
		return this.m_unRightPadding;
	}

	static get [Symbol.species]() {
		return Array;
	}
}

class ASCIITable {
	constructor(...vecColumns) {
		if (vecColumns.length === 0) {
			throw new RangeError("Table must have at least one column.");
		}

		const vecTableColumns = [];
		for (const ValueColumn of vecColumns) {
			const vecTableColumn = (ValueColumn instanceof Column) ? ValueColumn : new Column(ValueColumn);
			vecTableColumns.push(vecTableColumn);
		}

		this.m_vecColumns = vecTableColumns;
	}

	[Symbol.iterator]() {
		return this.m_vecColumns[Symbol.iterator]();
	}

	GetTableColumn(unIndex) {
		return this.m_vecColumns[unIndex];
	}

	AddTableRow(...vecItems) {
		const vecTableColumns = this.m_vecColumns;
		const unColumnCount = vecTableColumns.length;
		if (vecItems.length !== unColumnCount) {
			throw new RangeError("A row must have exactly the same number of items as the table has columns.");
		}

		const vecRowItems = [];
		for (const ValueItem of vecItems) {
			const RowItem = (ValueItem instanceof Item) ? ValueItem : new Item(ValueItem);
			vecRowItems.push(RowItem);
		}

		let unAppendedColumnCount = 0;

		try {
			for (let unColumnIndex = 0; unColumnIndex < unColumnCount; unColumnIndex += 1) {
				vecTableColumns[unColumnIndex].push(vecRowItems[unColumnIndex]);
				unAppendedColumnCount += 1;
			}
		} catch (RowAppendError) {
			for (let nRollbackColumnIndex = unAppendedColumnCount - 1; nRollbackColumnIndex >= 0; nRollbackColumnIndex -= 1) {
				vecTableColumns[nRollbackColumnIndex].pop();
			}

			throw RowAppendError;
		}

		return this;
	}

	FormatTable(strHeaderSeparator = "=", strColumnSeparator = "|") {
		if ((typeof strHeaderSeparator !== "string") || (strHeaderSeparator.length !== 1)) {
			throw new TypeError("Header separator must be a single character.");
		}

		if ((typeof strColumnSeparator !== "string") || (strColumnSeparator.length !== 1)) {
			throw new TypeError("Column separator must be a single character.");
		}

		const vecTableColumns = this.m_vecColumns;
		const vecFormattedColumns = [];
		for (const vecTableColumn of vecTableColumns) {
			vecFormattedColumns.push(vecTableColumn.FormatColumn());
		}

		let strFormattedHeader = "";
		let unMaximumRowCount = 0;
		for (let unColumnIndex = 0; unColumnIndex < vecFormattedColumns.length; unColumnIndex += 1) {
			const FormattedColumn = vecFormattedColumns[unColumnIndex];
			if (unColumnIndex > 0) {
				strFormattedHeader += strColumnSeparator;
			}

			strFormattedHeader += FormattedColumn.Header;
			unMaximumRowCount = Math.max(unMaximumRowCount, FormattedColumn.Rows.length);
		}

		const vecFormattedRows = [];
		for (let unRowIndex = 0; unRowIndex < unMaximumRowCount; unRowIndex += 1) {
			let strFormattedRow = "";
			for (let unColumnIndex = 0; unColumnIndex < vecFormattedColumns.length; unColumnIndex += 1) {
				const strFormattedCell = vecFormattedColumns[unColumnIndex].Rows[unRowIndex] ?? "";
				if (unColumnIndex > 0) {
					strFormattedRow += strColumnSeparator;
				}

				strFormattedRow += strFormattedCell;
			}

			vecFormattedRows.push(strFormattedRow);
		}

		const strHeaderSeparatorLine = strHeaderSeparator.repeat(strFormattedHeader.length);
		vecFormattedRows.unshift(strFormattedHeader, strHeaderSeparatorLine);

		return vecFormattedRows.join("\n");
	}

	get Columns() {
		return this.m_vecColumns;
	}

	get Length() {
		return this.m_vecColumns.length;
	}
}

module.exports = {
	MODULE_NAME: g_strModuleName,
	ASCIITable,
	Alignment: g_Alignment,
	Column,
	Item,
};
