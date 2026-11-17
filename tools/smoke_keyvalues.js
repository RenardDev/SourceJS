#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryPath, "packages", "sourcejs");
const g_strColorsPath = g_Path.join(g_strPackageRootPath, "colors.js");
const g_strKeyValuesPath = g_Path.join(g_strPackageRootPath, "keyvalues.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryPath, "docs", "api", "keyvalues.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");

function RejectColorMemoryAccess() {
	throw new Error("KeyValues color smoke must not access native memory.");
}

function LoadColorClass() {
	const unColorByteCount = 4;

	const ColorsModule = { exports: {} };
	const NativeColors = {
		CreateRGBAColor(unRed, unGreen, unBlue, unAlpha) {
			return { Red: unRed, Green: unGreen, Blue: unBlue, Alpha: unAlpha };
		},
	};
	const LoadColorsModule = new Function("require", "module", "exports", g_FileSystem.readFileSync(g_strColorsPath, "utf8"));
	LoadColorsModule((strModuleName) => {
		if (strModuleName === "internal/runtime") {
			return {
				GetModule(strNativeModuleName) {
					g_Assert.equal(strNativeModuleName, "colors");

					return NativeColors;
				},
			};
		}

		if (strModuleName === "memory") {
			return {
				RegisterObjectType(strTypeName, ColorType, TypeOptions) {
					g_Assert.equal(strTypeName, "Color");
					g_Assert.equal(typeof ColorType, "function");
					g_Assert.equal(TypeOptions.Size, unColorByteCount);
				},
			};
		}

		if (strModuleName === "memory/helpers") {
			return { Add: RejectColorMemoryAccess, IsNull: RejectColorMemoryAccess, Read: RejectColorMemoryAccess, Write: RejectColorMemoryAccess };
		}

		throw new Error(`Unexpected colors dependency: ${strModuleName}`);
	}, ColorsModule, ColorsModule.exports);

	return ColorsModule.exports.Color;
}

const g_Color = LoadColorClass();

const g_KeyValueType = Object.freeze({
	None: 0,
	String: 1,
	Int: 2,
	Float: 3,
	Address: 4,
	WideString: 5,
	Color: 6,
	UInt64: 7,
	NumberOfTypes: 8,
});

// Detached ownership/shape/dispatch fixture, not the SDK parser, conversion matrix or allocator.
function CreateNativeKeyValues({ SupportBoolean: bSupportsBooleanOperations = true } = {}) {
	const nMinimumInt32 = -2147483648;
	const nMaximumInt32 = 2147483647;
	const flMaximumFloat = 3.4028234663852886e38;
	const unMaximumColorComponent = 0xFF;
	const unMaximumUInt64 = 0xFFFFFFFFFFFFFFFFn;
	const unAddressBase = 0x100000n;
	const unAddressStride = 0x20n;

	const mapHandles = new Map();
	const mapNodes = new Map();
	const mapFiles = new Map();
	const mapNameSymbols = new Map();
	const vecCalls = [];
	let strCurrentPluginName = "keyvalues-smoke";
	let nNextNameSymbol = 0;
	let unNextHandleID = 1;
	let unNextNodeID = 1;

	function RequireString(Value, strOperation) {
		if (typeof Value !== "string") {
			throw new TypeError(`${strOperation} expects a string.`);
		}

		return Value;
	}

	function RequireBoolean(Value, strOperation) {
		if (typeof Value !== "boolean") {
			throw new TypeError(`${strOperation} expects a boolean.`);
		}

		return Value;
	}

	function RequireInt32(Value, strOperation) {
		if (!Number.isInteger(Value)) {
			throw new TypeError(`${strOperation} expects an integer.`);
		}

		if ((Value < nMinimumInt32) || (Value > nMaximumInt32)) {
			throw new RangeError(`${strOperation} expects a signed 32-bit integer.`);
		}

		return Value;
	}

	function RequireUInt64(Value, strOperation) {
		if (typeof Value !== "bigint") {
			throw new TypeError(`${strOperation} expects an unsigned 64-bit bigint.`);
		}

		if ((Value < 0n) || (Value > unMaximumUInt64)) {
			throw new RangeError(`${strOperation} expects an unsigned 64-bit value.`);
		}

		return Value;
	}

	function RequireFloat(Value, strOperation) {
		const flValue = +Value;
		if (!Number.isFinite(flValue)) {
			throw new Error(`${strOperation} expects a finite number.`);
		}

		if (Math.abs(flValue) > flMaximumFloat) {
			throw new Error(`${strOperation} expects a value in the finite float32 range.`);
		}

		return Math.fround(flValue);
	}

	function RequireAddress(unAddress, strOperation) {
		if (typeof unAddress !== "bigint") {
			throw new TypeError(`${strOperation} expects a BigInt address.`);
		}

		// This detached mock uses a 64-bit address domain; SDK adapter tests cover platform-width limits.
		if ((unAddress < 0n) || (unAddress > unMaximumUInt64)) {
			throw new RangeError(`${strOperation} expects a non-negative 64-bit address.`);
		}

		return unAddress;
	}

	function RequireOptionalName(Value, strOperation) {
		if ((Value === null) || (Value === undefined)) {
			return null;
		}

		return RequireString(Value, strOperation);
	}

	function RequireColor(Value, strOperation) {
		if (!Value || (typeof Value !== "object")) {
			throw new TypeError(`${strOperation} expects a color object.`);
		}

		const ColorValue = {};
		for (const strComponentName of ["Red", "Green", "Blue", "Alpha"]) {
			const unComponent = Value[strComponentName];
			if (!Number.isInteger(unComponent) || (unComponent < 0) || (unComponent > unMaximumColorComponent)) {
				throw new TypeError(`${strOperation} expects byte color components.`);
			}

			ColorValue[strComponentName] = unComponent;
		}

		return ColorValue;
	}

	// SDK name symbols are opaque interned identifiers, not string lengths.
	function InternNameSymbol(strName) {
		const nExistingSymbol = mapNameSymbols.get(strName);
		if (nExistingSymbol !== undefined) {
			return nExistingSymbol;
		}

		if (nNextNameSymbol > nMaximumInt32) {
			throw new Error("The detached KeyValues name-symbol space is exhausted.");
		}

		const nNameSymbol = nNextNameSymbol;
		nNextNameSymbol += 1;
		mapNameSymbols.set(strName, nNameSymbol);

		return nNameSymbol;
	}

	function CreateNode(strName = "") {
		const Node = {
			ID: unNextNodeID,
			Name: strName,
			NameSymbol: InternNameSymbol(strName),
			ParentID: 0,
			PeerID: 0,
			SubKeyID: 0,
			Type: g_KeyValueType.None,
			Value: null,
		};
		unNextNodeID += 1;

		mapNodes.set(Node.ID, Node);

		return Node;
	}

	function RegisterHandle(Node, bOwned) {
		const unHandle = unNextHandleID;
		unNextHandleID += 1;

		mapHandles.set(unHandle, { NodeID: Node.ID, Owned: bOwned, PluginName: strCurrentPluginName });

		return { Handle: unHandle };
	}

	function RequireHandle(Value) {
		const unHandle = (Value && (typeof Value === "object")) ? Value.Handle : Value;
		if (!Number.isInteger(unHandle) || (unHandle <= 0) || (unHandle > nMaximumInt32)) {
			throw new TypeError("A KeyValues native handle is required.");
		}

		return unHandle;
	}

	function RequireRecord(Value) {
		const unHandle = RequireHandle(Value);
		const HandleRecord = mapHandles.get(unHandle);
		if (!HandleRecord || !mapNodes.has(HandleRecord.NodeID)) {
			throw new Error("Unknown KeyValues native handle.");
		}

		if (HandleRecord.PluginName !== strCurrentPluginName) {
			throw new Error("KeyValues native handle belongs to another plugin context.");
		}

		return { HandleRecord, Node: mapNodes.get(HandleRecord.NodeID) };
	}

	function RegisterHandleForNode(Node, bOwned = false) {
		return Node ? RegisterHandle(Node, bOwned) : null;
	}

	function CollectTree(unNodeID, setNodeIDs = new Set()) {
		if (!unNodeID || setNodeIDs.has(unNodeID) || !mapNodes.has(unNodeID)) {
			return setNodeIDs;
		}

		setNodeIDs.add(unNodeID);
		const Node = mapNodes.get(unNodeID);
		CollectTree(Node.SubKeyID, setNodeIDs);
		CollectTree(Node.PeerID, setNodeIDs);

		return setNodeIDs;
	}

	function EraseHandleRecords(setNodeIDs) {
		for (const vecHandleEntry of mapHandles) {
			const unKeyValuesHandle = vecHandleEntry[0];
			const HandleRecord = vecHandleEntry[1];
			if (setNodeIDs.has(HandleRecord.NodeID)) {
				mapHandles.delete(unKeyValuesHandle);
			}
		}
	}

	function InvalidateDescendantHandleRecords(Node) {
		if (Node.SubKeyID) {
			EraseHandleRecords(CollectTree(Node.SubKeyID));
		}
	}

	function EraseNodes(setNodeIDs) {
		EraseHandleRecords(setNodeIDs);

		for (const unNodeID of setNodeIDs) {
			mapNodes.delete(unNodeID);
		}
	}

	function DestroyTree(Node) {
		EraseNodes(CollectTree(Node.ID));
	}

	function InvalidateDescendants(Node) {
		if (!Node.SubKeyID) {
			return;
		}

		EraseNodes(CollectTree(Node.SubKeyID));
		Node.SubKeyID = 0;
	}

	// Return a new list; its node references still belong to this detached fixture.
	function GetDirectChildren(Node) {
		const vecChildren = [];
		let unChildID = Node.SubKeyID;
		while (unChildID) {
			const Child = mapNodes.get(unChildID);
			if (!Child) {
				break;
			}

			vecChildren.push(Child);
			unChildID = Child.PeerID;
		}

		return vecChildren;
	}

	function FindChild(Node, strName) {
		return GetDirectChildren(Node).find((Child) => Child.Name === strName) ?? null;
	}

	function AppendChild(Parent, Child) {
		Child.ParentID = Parent.ID;
		Child.PeerID = 0;

		if (!Parent.SubKeyID) {
			Parent.SubKeyID = Child.ID;
			return;
		}

		const vecChildren = GetDirectChildren(Parent);
		vecChildren[vecChildren.length - 1].PeerID = Child.ID;
	}

	function FindOrCreateChild(Node, strName, bCreate) {
		let Child = FindChild(Node, strName);
		if (!Child && bCreate) {
			Child = CreateNode(strName);
			AppendChild(Node, Child);
		}

		return Child;
	}

	function ResolveTargetNode(Value, strName, bCreate = false) {
		const Node = RequireRecord(Value).Node;
		const strKeyName = RequireOptionalName(strName, "KeyValues key name");

		return (strKeyName === null) ? Node : FindOrCreateChild(Node, strKeyName, bCreate);
	}

	function CloneValue(Value) {
		if (!Value || (typeof Value !== "object")) {
			return Value;
		}

		return { ...Value };
	}

	function CloneNode(SourceNode) {
		const Copy = CreateNode(SourceNode.Name);
		Copy.Type = SourceNode.Type;
		Copy.Value = CloneValue(SourceNode.Value);

		for (const Child of GetDirectChildren(SourceNode)) {
			AppendChild(Copy, CloneNode(Child));
		}

		return Copy;
	}

	// JSON is only this in-memory test fixture's storage format, not the SDK's Valve KeyValues parser.
	function SerializeNode(Node) {
		return {
			Children: GetDirectChildren(Node).map(SerializeNode),
			Name: Node.Name,
			Type: Node.Type,
			Value: (typeof Node.Value === "bigint") ? `${Node.Value}n` : CloneValue(Node.Value),
		};
	}

	function DeserializeNode(SerializedNode) {
		const Node = CreateNode(RequireString(SerializedNode.Name, "Serialized KeyValues name"));
		Node.Type = RequireInt32(SerializedNode.Type, "Serialized KeyValues type");
		const bBigIntType = (Node.Type === g_KeyValueType.UInt64) || (Node.Type === g_KeyValueType.Address);
		Node.Value = (bBigIntType && (typeof SerializedNode.Value === "string") && /^\d+n$/.test(SerializedNode.Value)) ? BigInt(SerializedNode.Value.slice(0, -1)) : CloneValue(SerializedNode.Value);

		for (const SerializedChild of SerializedNode.Children ?? []) {
			AppendChild(Node, DeserializeNode(SerializedChild));
		}

		return Node;
	}

	function ReplaceNode(Target, SerializedNode) {
		InvalidateDescendants(Target);
		const Replacement = DeserializeNode(SerializedNode);
		Target.Name = Replacement.Name;
		Target.NameSymbol = Replacement.NameSymbol;
		Target.Type = Replacement.Type;
		Target.Value = Replacement.Value;
		Target.SubKeyID = Replacement.SubKeyID;

		for (const Child of GetDirectChildren(Target)) {
			Child.ParentID = Target.ID;
		}

		Replacement.SubKeyID = 0;
		mapNodes.delete(Replacement.ID);
	}

	function SetValue(Value, strName, unType, Data) {
		const Target = ResolveTargetNode(Value, strName, true);
		InvalidateDescendants(Target);
		Target.Type = unType;
		Target.Value = Data;

		return true;
	}

	function ReadValue(Value, strName, DefaultValue) {
		const Target = ResolveTargetNode(Value, strName, false);

		return Target ? Target.Value : DefaultValue;
	}

	function RequireUnchangedFloatRecord(unHandle, Record) {
		if ((mapHandles.get(unHandle) !== Record.HandleRecord) || (mapNodes.get(Record.HandleRecord.NodeID) !== Record.Node)) {
			throw new Error("keyvalues native handle was invalidated by a float conversion.");
		}
	}

	const NativeKeyValues = {
		Types() {
			return { ...g_KeyValueType };
		},

		Create(strName = "") {
			return RegisterHandle(CreateNode(RequireString(strName, "keyvalues.Create(strName)")), true);
		},

		Destroy(Value) {
			const unHandle = RequireHandle(Value);
			const HandleRecord = mapHandles.get(unHandle);
			if (!HandleRecord) {
				return false;
			}

			if (HandleRecord.PluginName !== strCurrentPluginName) {
				throw new Error("KeyValues native handle belongs to another plugin context.");
			}

			const Node = mapNodes.get(HandleRecord.NodeID);
			if (HandleRecord.Owned && Node) {
				DestroyTree(Node);

			} else {
				mapHandles.delete(unHandle);
			}

			return true;
		},

		Address(Value) {
			return unAddressBase + BigInt(RequireRecord(Value).Node.ID) * unAddressStride;
		},

		Name(Value) {
			return RequireRecord(Value).Node.Name;
		},

		SetName(Value, strName) {
			const Node = RequireRecord(Value).Node;
			const strResolvedName = RequireString(strName, "keyvalues.SetName(Value, strName)");
			const nNameSymbol = InternNameSymbol(strResolvedName);
			Node.Name = strResolvedName;
			Node.NameSymbol = nNameSymbol;

			return true;
		},

		NameSymbol(Value) {
			return RequireRecord(Value).Node.NameSymbol;
		},

		DataType(Value, strName = null) {
			return ResolveTargetNode(Value, strName, false)?.Type ?? g_KeyValueType.None;
		},

		FindKey(Value, strName, bCreate = false) {
			const Node = RequireRecord(Value).Node;
			const strKeyName = RequireString(strName, "keyvalues.FindKey(Value, strName, bCreate)");
			RequireBoolean(bCreate, "keyvalues.FindKey(Value, strName, bCreate)");

			return RegisterHandleForNode(FindOrCreateChild(Node, strKeyName, bCreate));
		},

		FindKeyBySymbol(Value, nKeySymbol) {
			const Node = RequireRecord(Value).Node;
			const nNameSymbol = RequireInt32(nKeySymbol, "keyvalues.FindKeyBySymbol(Value, nKeySymbol)");
			const Child = GetDirectChildren(Node).find((Candidate) => Candidate.NameSymbol === nNameSymbol) ?? null;

			return RegisterHandleForNode(Child);
		},

		CreateNewKey(Value) {
			const Node = RequireRecord(Value).Node;
			let strKeyName = "1";
			while (FindChild(Node, strKeyName)) {
				strKeyName = String(Number(strKeyName) + 1);
			}

			return RegisterHandleForNode(FindOrCreateChild(Node, strKeyName, true));
		},

		AddSubKey(Value, ChildValue) {
			const ParentRecord = RequireRecord(Value);
			const ChildRecord = RequireRecord(ChildValue);
			if (!ChildRecord.HandleRecord.Owned || (ParentRecord.Node === ChildRecord.Node) || CollectTree(ChildRecord.Node.ID).has(ParentRecord.Node.ID)) {
				throw new Error("keyvalues.AddSubKey(Value, ChildValue) expects a distinct owned child tree.");
			}

			if (ChildRecord.Node.PeerID !== 0) {
				throw new Error("keyvalues.AddSubKey(Value, ChildValue) expects an owned root without a next peer.");
			}

			AppendChild(ParentRecord.Node, ChildRecord.Node);

			for (const HandleRecord of mapHandles.values()) {
				if (HandleRecord.NodeID === ChildRecord.Node.ID) {
					HandleRecord.Owned = false;
				}
			}

			return true;
		},

		RemoveSubKey(Value, ChildValue) {
			const Parent = RequireRecord(Value).Node;
			const ChildRecord = RequireRecord(ChildValue);
			const Child = ChildRecord.Node;
			let Previous = null;
			let Current = mapNodes.get(Parent.SubKeyID) ?? null;
			while (Current && (Current !== Child)) {
				Previous = Current;
				Current = mapNodes.get(Current.PeerID) ?? null;
			}

			if (!Current) {
				return false;
			}

			if (Previous) {
				Previous.PeerID = Child.PeerID;

			} else {
				Parent.SubKeyID = Child.PeerID;
			}

			Child.ParentID = 0;
			Child.PeerID = 0;

			ChildRecord.HandleRecord.Owned = true;

			return true;
		},

		CopySubKeys(SourceValue, TargetValue) {
			const Source = RequireRecord(SourceValue).Node;
			const Target = RequireRecord(TargetValue).Node;
			if (Source === Target) {
				return true;
			}

			if (Target.SubKeyID !== 0) {
				throw new Error("keyvalues.CopySubKeys(SourceValue, TargetValue) expects a distinct target without subkeys.");
			}

			for (const Child of GetDirectChildren(Source)) {
				AppendChild(Target, CloneNode(Child));
			}

			return true;
		},

		MakeCopy(Value) {
			return RegisterHandle(CloneNode(RequireRecord(Value).Node), true);
		},

		FirstSubKey(Value) {
			return RegisterHandleForNode(mapNodes.get(RequireRecord(Value).Node.SubKeyID));
		},

		NextKey(Value) {
			return RegisterHandleForNode(mapNodes.get(RequireRecord(Value).Node.PeerID));
		},

		SetNextKey(Value, NextValue) {
			const Current = RequireRecord(Value).Node;
			const NextRecord = (NextValue === null) ? null : RequireRecord(NextValue);
			const PreviousNext = mapNodes.get(Current.PeerID) ?? null;
			if (PreviousNext === NextRecord?.Node) {
				return true;
			}

			if (NextRecord && (!NextRecord.HandleRecord.Owned || (Current === NextRecord.Node) || CollectTree(NextRecord.Node.ID).has(Current.ID))) {
				throw new Error("keyvalues.SetNextKey(Value, NextValue) expects a distinct owned next-key tree or null.");
			}

			Current.PeerID = NextRecord?.Node.ID ?? 0;

			if (NextRecord) {
				NextRecord.Node.ParentID = Current.ParentID;
			}

			if (PreviousNext) {
				let bPreviousNextHasRootHandle = false;
				for (const HandleRecord of mapHandles.values()) {
					if (HandleRecord.NodeID === PreviousNext.ID) {
						HandleRecord.Owned = true;
						bPreviousNextHasRootHandle = true;
					}
				}

				if (!bPreviousNextHasRootHandle) {
					DestroyTree(PreviousNext);
				}
			}

			if (NextRecord) {
				for (const HandleRecord of mapHandles.values()) {
					if (HandleRecord.NodeID === NextRecord.Node.ID) {
						HandleRecord.Owned = false;
					}
				}
			}

			return true;
		},

		FirstTrueSubKey(Value) {
			return RegisterHandleForNode(GetDirectChildren(RequireRecord(Value).Node).find((Child) => Child.Type === g_KeyValueType.None));
		},

		NextTrueSubKey(Value) {
			let Next = mapNodes.get(RequireRecord(Value).Node.PeerID) ?? null;
			while (Next && (Next.Type !== g_KeyValueType.None)) {
				Next = mapNodes.get(Next.PeerID) ?? null;
			}

			return RegisterHandleForNode(Next);
		},

		FirstValue(Value) {
			return RegisterHandleForNode(GetDirectChildren(RequireRecord(Value).Node).find((Child) => Child.Type !== g_KeyValueType.None));
		},

		NextValue(Value) {
			let Next = mapNodes.get(RequireRecord(Value).Node.PeerID) ?? null;
			while (Next && (Next.Type === g_KeyValueType.None)) {
				Next = mapNodes.get(Next.PeerID) ?? null;
			}

			return RegisterHandleForNode(Next);
		},

		GetInt(Value, strName = null, nDefaultValue = 0) {
			return ReadValue(Value, strName, RequireInt32(nDefaultValue, "keyvalues.GetInt nDefaultValue"));
		},

		GetUInt64(Value, strName = null, unDefaultValue = 0n) {
			return ReadValue(Value, strName, RequireUInt64(unDefaultValue, "keyvalues.GetUInt64 unDefaultValue"));
		},

		GetFloat(Value, strName = null, flDefaultValue = 0) {
			const unHandle = RequireHandle(Value);
			const Record = RequireRecord(unHandle);
			const strKeyName = RequireOptionalName(strName, "KeyValues key name");
			const flDefault = RequireFloat(flDefaultValue, "keyvalues.GetFloat flDefaultValue");
			RequireUnchangedFloatRecord(unHandle, Record);

			const Target = (strKeyName === null) ? Record.Node : FindOrCreateChild(Record.Node, strKeyName, false);

			return Target ? Target.Value : flDefault;
		},

		GetString(Value, strName = null, strDefaultValue = "") {
			return ReadValue(Value, strName, RequireString(strDefaultValue, "keyvalues.GetString strDefaultValue"));
		},

		GetColor(Value, strName = null, DefaultValue = { Red: 0, Green: 0, Blue: 0, Alpha: unMaximumColorComponent }) {
			return ReadValue(Value, strName, RequireColor(DefaultValue, "keyvalues.GetColor DefaultValue"));
		},

		GetAddress(Value, strName = null, unDefaultValue = 0n) {
			return ReadValue(Value, strName, RequireAddress(unDefaultValue, "keyvalues.GetAddress unDefaultValue"));
		},

		IsEmpty(Value, strName = null) {
			const Target = ResolveTargetNode(Value, strName, false);

			return !Target || ((Target.Type === g_KeyValueType.None) && (Target.SubKeyID === 0));
		},

		Clear(Value) {
			const Node = RequireRecord(Value).Node;
			InvalidateDescendants(Node);
			Node.Type = g_KeyValueType.None;
			Node.Value = null;

			return true;
		},

		SetString(Value, strName, Data) {
			return SetValue(Value, strName, g_KeyValueType.String, RequireString(Data, "keyvalues.SetString Data"));
		},

		SetInt(Value, strName, Data) {
			return SetValue(Value, strName, g_KeyValueType.Int, RequireInt32(Data, "keyvalues.SetInt Data"));
		},

		SetUInt64(Value, strName, Data) {
			return SetValue(Value, strName, g_KeyValueType.UInt64, RequireUInt64(Data, "keyvalues.SetUInt64 Data"));
		},

		SetFloat(Value, strName, Data) {
			const unHandle = RequireHandle(Value);
			const Record = RequireRecord(unHandle);
			const strKeyName = RequireOptionalName(strName, "KeyValues key name");
			const flValue = RequireFloat(Data, "keyvalues.SetFloat Data");
			RequireUnchangedFloatRecord(unHandle, Record);

			const Target = (strKeyName === null) ? Record.Node : FindOrCreateChild(Record.Node, strKeyName, true);
			InvalidateDescendants(Target);
			Target.Type = g_KeyValueType.Float;
			Target.Value = flValue;

			return true;
		},

		SetColor(Value, strName, Data) {
			return SetValue(Value, strName, g_KeyValueType.Color, RequireColor(Data, "keyvalues.SetColor Data"));
		},

		SetAddress(Value, strName, Data) {
			return SetValue(Value, strName, g_KeyValueType.Address, RequireAddress(Data, "keyvalues.SetAddress Data"));
		},

		Keys(Value) {
			return GetDirectChildren(RequireRecord(Value).Node).map((Child) => Child.Name);
		},

		ToString(Value) {
			const strText = JSON.stringify(SerializeNode(RequireRecord(Value).Node));
			vecCalls.push(["ToString", strText]);

			return strText;
		},

		LoadFromBuffer(Value, strBuffer, bUseEscapeSequences) {
			const RootNode = RequireRecord(Value).Node;
			RequireString(strBuffer, "keyvalues.LoadFromBuffer strBuffer");
			RequireBoolean(bUseEscapeSequences, "keyvalues.LoadFromBuffer bUseEscapeSequences");
			InvalidateDescendantHandleRecords(RootNode);
			vecCalls.push(["LoadFromBuffer", strBuffer, bUseEscapeSequences]);

			try {
				ReplaceNode(RootNode, JSON.parse(strBuffer));

				return true;
			} catch (ErrorValue) {
				if (ErrorValue instanceof SyntaxError) {
					return false;
				}

				throw ErrorValue;
			}
		},

		LoadFromFile(Value, strFileName, bUseEscapeSequences) {
			const RootNode = RequireRecord(Value).Node;
			const strFilePath = RequireString(strFileName, "keyvalues.LoadFromFile strFileName");
			RequireBoolean(bUseEscapeSequences, "keyvalues.LoadFromFile bUseEscapeSequences");
			InvalidateDescendantHandleRecords(RootNode);

			if (!mapFiles.has(strFilePath)) {
				return false;
			}

			return this.LoadFromBuffer(Value, mapFiles.get(strFilePath), bUseEscapeSequences);
		},

		SaveToFile(Value, strFileName) {
			const strFilePath = RequireString(strFileName, "keyvalues.SaveToFile strFileName");
			mapFiles.set(strFilePath, this.ToString(Value));

			return true;
		},
	};

	if (bSupportsBooleanOperations) {
		NativeKeyValues.GetBool = function GetBool(Value, strName = null, bDefaultValue = false) {
			const bFallback = RequireBoolean(bDefaultValue, "keyvalues.GetBool bDefaultValue");

			return Boolean(ReadValue(Value, strName, bFallback));
		};

		NativeKeyValues.SetBool = function SetBool(Value, strName, Data) {
			const bValue = RequireBoolean(Data, "keyvalues.SetBool Data");

			return SetValue(Value, strName, g_KeyValueType.Int, bValue ? 1 : 0);
		};
	}

	NativeKeyValues.Debug = {
		Calls: vecCalls,
		Files: mapFiles,

		get HandleCount() {
			return mapHandles.size;
		},

		get NodeCount() {
			return mapNodes.size;
		},

		IsHandleOwned(Value) {
			return RequireRecord(Value).HandleRecord.Owned;
		},

		ReleasePlugin(strPluginName) {
			for (;;) {
				const OwnerRecord = [...mapHandles.values()].find((HandleRecord) => (HandleRecord.PluginName === strPluginName) && HandleRecord.Owned);
				if (!OwnerRecord) {
					break;
				}

				DestroyTree(mapNodes.get(OwnerRecord.NodeID));
			}

			for (const vecHandleEntry of mapHandles) {
				const unHandle = vecHandleEntry[0];
				const HandleRecord = vecHandleEntry[1];
				if (HandleRecord.PluginName === strPluginName) {
					mapHandles.delete(unHandle);
				}
			}
		},

		SetPlugin(strPluginName) {
			strCurrentPluginName = RequireString(strPluginName, "plugin name");
		},
	};

	return NativeKeyValues;
}

// SourceMod's repeated external section/key names must survive opt-in object conversion.
function CheckDuplicateKeyValuesConversion(KeyValues) {
	const Root = new KeyValues("Games");
	try {
		for (const strEngine of ["css", "tf2", "csgo"]) {
			const DefaultSection = new KeyValues("#default");
			const SupportedSection = new KeyValues("#supported");
			for (const strSupportedEngine of ["orangebox", strEngine]) {
				const EngineValue = new KeyValues("engine");
				EngineValue.SetKeyValuesString(null, strSupportedEngine);
				SupportedSection.AddKeyValuesSubKey(EngineValue);
				EngineValue.DestroyKeyValues();
			}

			DefaultSection.AddKeyValuesSubKey(SupportedSection);
			SupportedSection.DestroyKeyValues();
			Root.AddKeyValuesSubKey(DefaultSection);
			DefaultSection.DestroyKeyValues();
		}

		for (const strValue of ["First", "Second", "Third"]) {
			const PrototypeValue = new KeyValues("__proto__");
			PrototypeValue.SetKeyValuesString(null, strValue);
			Root.AddKeyValuesSubKey(PrototypeValue);
			PrototypeValue.DestroyKeyValues();
		}

		for (const unValue of [0x8000000000000000n, 0xFFFFFFFFFFFFFFFFn]) {
			const ExactValue = new KeyValues("UInt64");
			ExactValue.SetKeyValuesUInt64(null, unValue);
			Root.AddKeyValuesSubKey(ExactValue);
			ExactValue.DestroyKeyValues();
		}

		const ExpectedLastValues = {
			"#default": {
				"#supported": { engine: "csgo" },
			},
			["__proto__"]: "Third",
			UInt64: 0xFFFFFFFFFFFFFFFFn,
		};
		g_Assert.deepEqual(Root.ConvertKeyValuesToObject(), ExpectedLastValues, "ordinary conversion retains last-value semantics");
		const PreservedValues = Root.ConvertKeyValuesToObject(true);
		g_Assert.deepEqual(PreservedValues, {
			"#default": ["css", "tf2", "csgo"].map((strEngine) => ({ "#supported": { engine: ["orangebox", strEngine] } })),
			["__proto__"]: ["First", "Second", "Third"],
			UInt64: [0x8000000000000000n, 0xFFFFFFFFFFFFFFFFn],
		}, "duplicate sections and nested scalar keys retain every occurrence in order");
		g_Assert.equal(Object.getPrototypeOf(PreservedValues), Object.prototype);
		g_Assert.equal(Object.hasOwn(PreservedValues, "__proto__"), true);
		g_Assert.deepEqual(Root.ConvertKeyValuesToObject(false), ExpectedLastValues, "preserving conversion does not mutate the native tree");
		for (const InvalidPreservation of [null, 0, 1, "true", {}, []]) {
			g_Assert.throws(() => Root.ConvertKeyValuesToObject(InvalidPreservation), TypeError);
		}
	} finally {
		Root.DestroyKeyValues();
	}
}

function LoadKeyValues(NativeKeyValues = undefined) {
	const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const vecCacheSnapshots = [g_strKeyValuesPath, g_strColorsPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const OriginalModuleLoad = g_Module._load;
	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		if (NativeKeyValues === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { keyvalues: NativeKeyValues } });
		}

		require.cache[g_strColorsPath] = { exports: { Color: g_Color }, filename: g_strColorsPath, id: g_strColorsPath, loaded: true };
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
			}

			if (strRequestName === "colors") {
				return OriginalModuleLoad.call(this, g_strColorsPath, ParentModule, bIsMain);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strKeyValuesPath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		if (BridgeDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", BridgeDescriptor);
		}

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	}
}

function DestroyResult(Result) {
	if (Result && (typeof Result.DestroyKeyValues === "function") && (Result.Handle !== null)) {
		Result.DestroyKeyValues();
	}
}

function ExtractDocumentationBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function RunKeyValuesDocumentationExample(strExampleSource, Modules, LogMessage = () => undefined) {
	g_Assert.doesNotMatch(strExampleSource, /\bconsole\s*\./, "KeyValues examples must use the typed loggers module.");
	const Logger = {
		LogInfo(strMessage) {
			g_Assert.equal(typeof strMessage, "string");
			g_Assert.ok(strMessage.length > 0);
			g_Assert.doesNotMatch(strMessage, /^\s*\[(?:DEBUG|INFO|WARNING|ERROR)\]/);
			LogMessage(strMessage);
		},
	};

	// Owned examples deliberately retain host-realm Error, Array and Color identities.
	const RunExample = new Function("require", strExampleSource);
	RunExample((strModuleName) => {
		if (strModuleName === "loggers") {
			return Logger;
		}

		g_Assert.ok(Object.hasOwn(Modules, strModuleName), `Unexpected documentation module: ${strModuleName}`);

		return Modules[strModuleName];
	});
}

function RunKeyValuesDocumentationCleanupScenario(strExampleSource, Scenario, PrimaryCase, vecCleanupFailureIndices, bSupportsBooleanOperations, GlobalVariablesModule) {
	const NativeKeyValues = CreateNativeKeyValues({ SupportBoolean: bSupportsBooleanOperations });
	const OriginalOperation = NativeKeyValues[Scenario.PrimaryOperation];
	const OriginalDestroy = NativeKeyValues.Destroy;
	const vecCleanupNames = [];
	const vecCleanupFailures = [];
	const mapCleanupLabels = new Map();
	let bCleanupArmed = false;

	function SignalControlledOperation() {
		bCleanupArmed = true;

		if (PrimaryCase.Active) {
			throw PrimaryCase.Failure;
		}
	}

	function RecordFinalCleanup(strName, bCleanupResult) {
		const unCleanupIndex = vecCleanupNames.length;
		vecCleanupNames.push(strName);

		if (vecCleanupFailureIndices.includes(unCleanupIndex)) {
			const CleanupFailure = new Error(`Controlled KeyValues cleanup ${unCleanupIndex} failed.`);
			vecCleanupFailures.push(CleanupFailure);
			throw CleanupFailure;
		}

		return bCleanupResult;
	}

	if (typeof OriginalOperation === "function") {
		NativeKeyValues[Scenario.PrimaryOperation] = function RunControlledOperation(...vecArguments) {
			const bTargetOperation = (NativeKeyValues.Name(vecArguments[0]) === Scenario.RootName) && (Scenario.AnyPrimaryKey || (vecArguments[1] === Scenario.PrimaryKey)) && (!Scenario.ReadOnlyLookup || !vecArguments[2]);
			if (bTargetOperation && Scenario.ThrowBeforeOperation) {
				SignalControlledOperation();
			}

			const Result = Reflect.apply(OriginalOperation, this, vecArguments);
			if (Scenario.LabelBufferLoads) {
				mapCleanupLabels.set(NativeKeyValues.Address(vecArguments[0]), bTargetOperation ? "Reusable" : "Parsed");
			}

			if (bTargetOperation && !Scenario.ThrowBeforeOperation) {
				SignalControlledOperation();
			}

			return Result;
		};

	} else {
		g_Assert.ok(Scenario.IteratorNext || Scenario.ReducedLoggingPrimary || Scenario.EarlyCacheRelease);
	}

	NativeKeyValues.Destroy = function DestroyControlledKeyValues(Handle) {
		if (Scenario.EarlyCacheRelease && !bCleanupArmed && (NativeKeyValues.Name(Handle) === "Cache")) {
			const bDestroyed = Reflect.apply(OriginalDestroy, this, [Handle]);
			SignalControlledOperation();
			return bDestroyed;
		}

		if (!bCleanupArmed) {
			return Reflect.apply(OriginalDestroy, this, [Handle]);
		}

		const strName = mapCleanupLabels.get(NativeKeyValues.Address(Handle)) ?? NativeKeyValues.Name(Handle);
		// Inject after the double commits release; this does not emulate an SDK delete failure.
		const bDestroyed = Reflect.apply(OriginalDestroy, this, [Handle]);

		return RecordFinalCleanup(strName, bDestroyed);
	};

	if (Scenario.LabelCopy) {
		const OriginalMakeCopy = NativeKeyValues.MakeCopy;
		NativeKeyValues.MakeCopy = function MakeControlledCopy(Handle) {
			const Result = Reflect.apply(OriginalMakeCopy, this, [Handle]);
			mapCleanupLabels.set(NativeKeyValues.Address(Result), "Copy");

			return Result;
		};
	}

	if (Scenario.LabelLoaded) {
		const OriginalLoadFromFile = NativeKeyValues.LoadFromFile;
		NativeKeyValues.LoadFromFile = function LoadControlledFile(...vecArguments) {
			const bLoaded = Reflect.apply(OriginalLoadFromFile, this, vecArguments);
			mapCleanupLabels.set(NativeKeyValues.Address(vecArguments[0]), "LoadedSettings");

			return bLoaded;
		};
	}

	const FileSystemModule = {
		DoesFileExist(strFileName) {
			return NativeKeyValues.Debug.Files.has(strFileName);
		},

		RemoveFile(strFileName) {
			const bRemoved = NativeKeyValues.Debug.Files.delete(strFileName);

			return bCleanupArmed ? RecordFinalCleanup("TemporaryFile", bRemoved) : bRemoved;
		},
	};
	const KeyValuesModule = LoadKeyValues(NativeKeyValues);
	if (Scenario.IteratorNext) {
		const OriginalNext = KeyValuesModule.KeyValuesIterator.prototype.next;
		KeyValuesModule.KeyValuesIterator.prototype.next = function NextControlledKeyValues() {
			const Result = Reflect.apply(OriginalNext, this, []);
			SignalControlledOperation();

			return Result;
		};
	}

	const Modules = { colors: { Color: g_Color }, filesystem: FileSystemModule, globals: GlobalVariablesModule, keyvalues: KeyValuesModule };
	const LogMessage = () => {
		if (Scenario.ReducedLoggingPrimary && !bSupportsBooleanOperations) {
			SignalControlledOperation();
		}
	};
	let ObservedFailure = undefined;
	let bThrew = false;
	try {
		RunKeyValuesDocumentationExample(strExampleSource, Modules, LogMessage);
	} catch (Failure) {
		ObservedFailure = Failure;
		bThrew = true;
	}

	g_Assert.equal(bCleanupArmed, true, "The controlled operation must execute.");
	g_Assert.deepEqual(vecCleanupNames, Scenario.CleanupNames, `${Scenario.Name}: every retained resource must receive one cleanup attempt in order.`);
	g_Assert.equal(NativeKeyValues.Debug.HandleCount, 0, "Post-commit cleanup failures must not leave fixture handles behind.");
	g_Assert.equal(NativeKeyValues.Debug.NodeCount, 0, "Post-commit cleanup failures must not leave fixture trees behind.");
	g_Assert.equal(NativeKeyValues.Debug.Files.size, 0, "File cleanup must still run after wrapper cleanup fails.");

	const vecExpectedFailures = PrimaryCase.Active ? [PrimaryCase.Failure] : [];
	vecExpectedFailures.push(...vecCleanupFailures);
	g_Assert.equal(bThrew, vecExpectedFailures.length > 0);

	if (vecExpectedFailures.length === 1) {
		g_Assert.equal(ObservedFailure, vecExpectedFailures[0], "A sole failure must retain its exact identity, including primitive values.");
	}

	if (vecExpectedFailures.length > 1) {
		g_Assert.ok(ObservedFailure instanceof AggregateError);
		g_Assert.deepEqual(ObservedFailure.errors, vecExpectedFailures, "The operation failure must precede cleanup failures in attempted order.");

		for (let unFailureIndex = 0; unFailureIndex < vecExpectedFailures.length; ++unFailureIndex) {
			g_Assert.equal(ObservedFailure.errors[unFailureIndex], vecExpectedFailures[unFailureIndex]);
		}
	}
}

function VerifyKeyValuesDocumentationFileGuards(vecExamples) {
	const unExpectedScenarioCount = 6;

	const vecMatches = vecExamples.filter((strSource) => strSource.includes("const g_ValidateKeyValuesFileRoundTrip ="));
	g_Assert.equal(vecMatches.length, 1);

	const vecFilePathMatch = vecMatches[0].match(/const strKeyValuesFilePath = "([^"]+)";/);
	g_Assert.ok(vecFilePathMatch);

	const strFileName = vecFilePathMatch[1];
	let unScenarioCount = 0;
	for (const bSupportsBooleanOperations of [true, false]) {
		const NativeKeyValues = CreateNativeKeyValues({ SupportBoolean: bSupportsBooleanOperations });
		let unRemoveCount = 0;
		const FileSystemModule = {
			DoesFileExist(strPath) {
				return NativeKeyValues.Debug.Files.has(strPath);
			},

			RemoveFile(strPath) {
				++unRemoveCount;
				NativeKeyValues.Debug.Files.delete(strPath);

				return false;
			},
		};
		const Modules = { filesystem: FileSystemModule, keyvalues: LoadKeyValues(NativeKeyValues) };
		const strForeignContents = "Foreign configuration fixture; must remain unchanged.";
		NativeKeyValues.Debug.Files.set(strFileName, strForeignContents);
		g_Assert.throws(() => RunKeyValuesDocumentationExample(vecMatches[0], Modules), /Refusing to overwrite existing file/);
		++unScenarioCount;
		g_Assert.equal(NativeKeyValues.Debug.Files.get(strFileName), strForeignContents);
		g_Assert.equal(unRemoveCount, 0);
		g_Assert.equal(NativeKeyValues.Debug.HandleCount, 0);
		g_Assert.equal(NativeKeyValues.Debug.NodeCount, 0);

		// Remove only this test's in-memory sentinel, never an actual filesystem path.
		NativeKeyValues.Debug.Files.delete(strFileName);
		g_Assert.throws(() => RunKeyValuesDocumentationExample(vecMatches[0], Modules), /Could not remove/);
		++unScenarioCount;
		g_Assert.equal(unRemoveCount, 1);
		g_Assert.equal(NativeKeyValues.Debug.Files.size, 0);
		g_Assert.equal(NativeKeyValues.Debug.HandleCount, 0);
		g_Assert.equal(NativeKeyValues.Debug.NodeCount, 0);

		const OriginalDestroy = NativeKeyValues.Destroy;
		const CleanupFailure = new Error("Controlled root cleanup failed.");
		let bRootFailurePending = true;
		NativeKeyValues.Destroy = function DestroyControlledRoot(Handle) {
			const strName = NativeKeyValues.Name(Handle);
			const bDestroyed = Reflect.apply(OriginalDestroy, this, [Handle]);
			if (bRootFailurePending && (strName === "RuntimeSettings")) {
				bRootFailurePending = false;
				throw CleanupFailure;
			}

			return bDestroyed;
		};

		g_Assert.throws(() => RunKeyValuesDocumentationExample(vecMatches[0], Modules), (Failure) => {
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.equal(Failure.errors.length, 2);
			g_Assert.equal(Failure.errors[0], CleanupFailure);
			g_Assert.match(Failure.errors[1].message, /Could not remove/);

			return true;
		});
		++unScenarioCount;
		g_Assert.equal(bRootFailurePending, false);
		g_Assert.equal(unRemoveCount, 2);
		g_Assert.equal(NativeKeyValues.Debug.Files.size, 0);
		g_Assert.equal(NativeKeyValues.Debug.HandleCount, 0);
		g_Assert.equal(NativeKeyValues.Debug.NodeCount, 0);
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
}

function VerifyKeyValuesDocumentationCleanup(vecExamples, GlobalVariablesModule) {
	const unExpectedScenarioCount = 694;

	const vecScenarios = [
		{
			Name: "g_ValidatePluginConfiguration",
			RootName: "SourceJSPlugin",
			PrimaryOperation: "GetString",
			PrimaryKey: "Mode",
			CleanupNames: ["SourceJSPlugin"],
		},
		{
			Name: "g_ValidateTypedKeyValues",
			RootName: "RuntimeState",
			PrimaryOperation: "DataType",
			PrimaryKey: "Accent",
			CleanupNames: ["RuntimeState"],
		},
		{
			Name: "g_ValidateLiveKeyWrappers",
			RootName: "Metadata",
			PrimaryOperation: "FindKey",
			PrimaryKey: "Missing",
			CleanupNames: ["Author", "Author", "Metadata"],
		},
		{
			Name: "g_ValidateKeyValuesTraversal",
			RootName: "Tree",
			PrimaryOperation: "Keys",
			PrimaryKey: undefined,
			CleanupNames: ["Mode", "Visible", "Server", "Visible", "Tree"],
		},
		{
			Name: "g_ValidateOwnedSubtreeTransfer",
			RootName: "Cache",
			PrimaryOperation: "GetInt",
			PrimaryKey: "Generation",
			CleanupNames: ["Cache", "Root"],
		},
		{
			Name: "g_ValidateOwnedSubtreeTransfer",
			EarlyCacheRelease: true,
			PrimaryOnly: true,
			CleanupNames: ["Root"],
		},
		{
			Name: "g_ValidateOwnedSubtreeTransfer",
			RootName: "Root",
			PrimaryOperation: "AddSubKey",
			AnyPrimaryKey: true,
			ThrowBeforeOperation: true,
			PrimaryOnly: true,
			CleanupNames: ["Cache", "Root"],
		},
		{
			Name: "g_ValidateOwnedSubtreeTransfer",
			RootName: "Root",
			PrimaryOperation: "AddSubKey",
			AnyPrimaryKey: true,
			PrimaryOnly: true,
			CleanupNames: ["Cache", "Root"],
		},
		{
			Name: "g_ValidatePeerReplacement",
			RootName: "Peers",
			PrimaryOperation: "Keys",
			PrimaryKey: undefined,
			CleanupNames: ["Replacement", "Second", "First", "Peers"],
		},
		{
			Name: "g_ValidateIndependentKeyValuesCopies",
			RootName: "Target",
			PrimaryOperation: "FindKey",
			PrimaryKey: "Stale",
			ReadOnlyLookup: true,
			LabelCopy: true,
			CleanupNames: ["Mode", "1", "Target", "Copy", "Source"],
		},
		{
			Name: "g_ValidateTransientKeyValuesCleanup",
			RootName: "Transient",
			PrimaryOperation: "Keys",
			PrimaryKey: undefined,
			CleanupNames: ["Transient"],
		},
		{
			Name: "g_ValidatePointInTimeCollections",
			RootName: "Rotation",
			PrimaryOperation: "GetString",
			PrimaryKey: "First",
			CleanupNames: ["Rotation"],
		},
		{
			Name: "g_ValidateKeyValuesTextRoundTrip",
			RootName: "Reusable",
			PrimaryOperation: "LoadFromBuffer",
			AnyPrimaryKey: true,
			LabelBufferLoads: true,
			CleanupNames: ["Reusable", "Parsed", "Vote"],
		},
		{
			Name: "g_ValidateKeyValuesFileRoundTrip",
			RootName: "RuntimeSettings",
			PrimaryOperation: "GetString",
			PrimaryKey: "Language",
			LabelLoaded: true,
			CleanupNames: ["LoadedSettings", "RuntimeSettings", "TemporaryFile"],
		},
		{
			Name: "g_ValidateKeyValuesFileRoundTrip",
			RootName: "RuntimeSettings",
			PrimaryOperation: "SaveToFile",
			AnyPrimaryKey: true,
			PrimaryOnly: true,
			CleanupNames: ["RuntimeSettings", "TemporaryFile"],
		},
		{
			Name: "g_ValidateTypedPayloadValues",
			RootName: "Payload",
			PrimaryOperation: "GetUInt64",
			PrimaryKey: "WorkshopID",
			CleanupNames: ["Payload"],
		},
		{
			Name: "g_ValidateSDKBooleanCapability",
			RootName: "Flags",
			PrimaryOperation: "GetBool",
			PrimaryKey: "Enabled",
			ReducedLoggingPrimary: true,
			CleanupNames: ["Flags"],
		},
		{
			Name: "g_ValidateEarlyIteratorReturn",
			IteratorNext: true,
			CleanupNames: ["Slots", "Session"],
		},
		{
			Name: "g_ValidateEarlyIteratorReturn",
			RootName: "Session",
			PrimaryOperation: "FirstSubKey",
			PrimaryKey: undefined,
			ThrowBeforeOperation: true,
			PrimaryOnly: true,
			CleanupNames: ["Session"],
		},
		{
			Name: "g_ValidateEarlyIteratorReturn",
			RootName: "Session",
			PrimaryOperation: "FirstSubKey",
			PrimaryKey: undefined,
			PrimaryOnly: true,
			CleanupNames: ["Session"],
		},
	];
	const vecPrimaryCases = [
		{ Active: false },
		{ Active: true, Failure: new Error("Controlled KeyValues operation failed.") },
		{ Active: true, Failure: null },
		{ Active: true, Failure: undefined },
		{ Active: true, Failure: 0 },
	];
	let unScenarioCount = 0;
	for (const Scenario of vecScenarios) {
		const vecMatches = vecExamples.filter((strSource) => strSource.includes("const " + Scenario.Name + " ="));
		g_Assert.equal(vecMatches.length, 1);

		const vecCleanupCases = [[]];
		const vecAllCleanupIndices = [];
		for (let unCleanupIndex = 0; unCleanupIndex < Scenario.CleanupNames.length; ++unCleanupIndex) {
			vecCleanupCases.push([unCleanupIndex]);
			vecAllCleanupIndices.push(unCleanupIndex);
		}

		if (vecAllCleanupIndices.length > 1) {
			vecCleanupCases.push(vecAllCleanupIndices);
		}

		for (const bSupportsBooleanOperations of [true, false]) {
			for (const PrimaryCase of vecPrimaryCases) {
				if (Scenario.PrimaryOnly && !PrimaryCase.Active) {
					continue;
				}

				for (const vecCleanupFailureIndices of vecCleanupCases) {
					RunKeyValuesDocumentationCleanupScenario(vecMatches[0], Scenario, PrimaryCase, vecCleanupFailureIndices, bSupportsBooleanOperations, GlobalVariablesModule);
					++unScenarioCount;
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);

	VerifyKeyValuesDocumentationFileGuards(vecExamples);
}

function VerifyKeyValuesConstructionCleanup() {
	const unExpectedScenarioCount = 168;

	const vecFailures = [
		undefined,
		null,
		false,
		0,
		0n,
		"",
		NaN,
		Symbol("construction"),
		new Error("Controlled construction failure."),
	];
	const vecOperationNames = [
		"ConstructorObject",
		"ConstructorFirstValue",
		"ConstructorSecondValue",
		"ObjectFactory",
		"BufferFactory",
		"FileFactory",
		"BufferFalse",
		"FileFalse",
	];
	let unScenarioCount = 0;
	for (const strOperationName of vecOperationNames) {
		const bReturnsFalse = strOperationName.endsWith("False");
		const vecPrimaryFailures = bReturnsFalse ? [undefined] : vecFailures;
		for (let unFailureIndex = 0; unFailureIndex < vecPrimaryFailures.length; ++unFailureIndex) {
			const PrimaryFailure = vecPrimaryFailures[unFailureIndex];
			const CleanupFailure = vecFailures[(unFailureIndex + 1) % vecFailures.length];
			for (const strReleaseMode of ["RELEASED", "INVALIDATED", "THROW"]) {
				const NativeHandle = {};
				let RootKeyValues = null;
				let unDestroyCalls = 0;
				const NativeRuntime = {
					Types() {
						return g_KeyValueType;
					},

					Create() {
						return NativeHandle;
					},

					Destroy(Handle) {
						g_Assert.strictEqual(Handle, NativeHandle);
						++unDestroyCalls;

						if (strReleaseMode === "THROW") {
							throw CleanupFailure;
						}

						return strReleaseMode === "RELEASED";
					},
				};
				const { KeyValues } = LoadKeyValues(NativeRuntime);
				const FailInitialization = function() {
					RootKeyValues = this;

					if (bReturnsFalse) {
						return false;
					}

					throw PrimaryFailure;
				};
				KeyValues.prototype.AddKeyValuesObject = FailInitialization;
				KeyValues.prototype.SetKeyValuesValue = FailInitialization;
				KeyValues.prototype.LoadKeyValuesFromBufferInPlace = FailInitialization;
				KeyValues.prototype.LoadKeyValuesFromFileInPlace = FailInitialization;

				const Operations = {
					ConstructorObject: () => new KeyValues("Cleanup", Object.create(null)),
					ConstructorFirstValue: () => new KeyValues("Cleanup", "First", 1),
					ConstructorSecondValue: () => new KeyValues("Cleanup", undefined, undefined, "Second", 1),
					ObjectFactory: () => KeyValues.CreateKeyValuesFromObject("Cleanup", Object.create(null)),
					BufferFactory: () => KeyValues.CreateKeyValuesFromBuffer("buffer"),
					FileFactory: () => KeyValues.CreateKeyValuesFromFile("file"),
					BufferFalse: () => KeyValues.CreateKeyValuesFromBuffer("buffer"),
					FileFalse: () => KeyValues.CreateKeyValuesFromFile("file"),
				};
				let bCaught = false;
				let ObservedFailure = undefined;
				try {
					Operations[strOperationName]();
				} catch (Failure) {
					bCaught = true;
					ObservedFailure = Failure;
				}

				g_Assert.equal(bCaught, true, strOperationName);
				g_Assert.equal(unDestroyCalls, 1, `${strOperationName}: release the acquired root exactly once.`);
				let ObservedPrimaryFailure = ObservedFailure;
				if (strReleaseMode === "THROW") {
					g_Assert(ObservedFailure instanceof AggregateError, `${strOperationName}: initialization and cleanup failures must both survive.`);
					g_Assert.equal(ObservedFailure.errors.length, 2);
					g_Assert(Object.is(ObservedFailure.errors[1], CleanupFailure));
					ObservedPrimaryFailure = ObservedFailure.errors[0];
					g_Assert.strictEqual(RootKeyValues.Handle, NativeHandle, "A thrown destroy must not claim release by clearing the handle.");

				} else {
					g_Assert.strictEqual(RootKeyValues.Handle, null, "A non-throwing destroy retains the established invalidation behavior.");
				}

				if (bReturnsFalse) {
					g_Assert(ObservedPrimaryFailure instanceof Error);
					g_Assert.equal(ObservedPrimaryFailure.message, (strOperationName === "BufferFalse") ? "Could not parse the KeyValues buffer." : "Could not load the KeyValues file.");

				} else {
					g_Assert(Object.is(ObservedPrimaryFailure, PrimaryFailure), "Preserve the original thrown value, including falsy values.");
				}

				++unScenarioCount;
			}
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
	console.log("[  OK  ] KeyValues construction cleanup: " + unScenarioCount + " independent failure scenarios passed");
}

function VerifyKeyValuesChildInitializationCleanup() {
	const unExpectedScenarioCount = 27;

	const vecFailures = [
		undefined,
		null,
		false,
		0,
		0n,
		"",
		NaN,
		Symbol("child"),
		new Error("Controlled child failure."),
	];
	let unScenarioCount = 0;
	for (let unFailureIndex = 0; unFailureIndex < vecFailures.length; ++unFailureIndex) {
		const PrimaryFailure = vecFailures[unFailureIndex];
		const CleanupFailure = vecFailures[(unFailureIndex + 1) % vecFailures.length];
		for (const strReleaseMode of ["RELEASED", "INVALIDATED", "THROW"]) {
			const RootHandle = {};
			const ChildHandle = {};
			let ChildKeyValues = null;
			let unDestroyCalls = 0;
			const NativeRuntime = {
				Types() {
					return g_KeyValueType;
				},

				Create() {
					return RootHandle;
				},

				FindKey(Handle, strName, bCreateKey) {
					g_Assert.strictEqual(Handle, RootHandle);
					g_Assert.equal(strName, "Value");
					g_Assert.equal(bCreateKey, true);

					return ChildHandle;
				},

				Clear(Handle) {
					g_Assert.strictEqual(Handle, ChildHandle);
					throw PrimaryFailure;
				},

				Destroy(Handle) {
					g_Assert.strictEqual(Handle, ChildHandle, "A failed child write must not destroy the root.");
					++unDestroyCalls;

					if (strReleaseMode === "THROW") {
						throw CleanupFailure;
					}

					return strReleaseMode === "RELEASED";
				},
			};
			const { KeyValues } = LoadKeyValues(NativeRuntime);
			const ClearKeyValues = KeyValues.prototype.ClearKeyValues;
			KeyValues.prototype.ClearKeyValues = function() {
				ChildKeyValues = this;

				return ClearKeyValues.call(this);
			};

			const RootKeyValues = new KeyValues("Cleanup");
			let bCaught = false;
			let ObservedFailure = undefined;
			try {
				RootKeyValues.SetKeyValuesValue("Value", 1);
			} catch (Failure) {
				bCaught = true;
				ObservedFailure = Failure;
			}

			g_Assert.equal(bCaught, true);
			g_Assert.equal(unDestroyCalls, 1);
			g_Assert.strictEqual(RootKeyValues.Handle, RootHandle);

			if (strReleaseMode === "THROW") {
				g_Assert(ObservedFailure instanceof AggregateError, "SetKeyValuesValue: operation and cleanup failures must both survive.");
				g_Assert.equal(ObservedFailure.errors.length, 2);
				g_Assert(Object.is(ObservedFailure.errors[0], PrimaryFailure));
				g_Assert(Object.is(ObservedFailure.errors[1], CleanupFailure));
				g_Assert.strictEqual(ChildKeyValues.Handle, ChildHandle);

			} else {
				g_Assert(Object.is(ObservedFailure, PrimaryFailure));
				g_Assert.strictEqual(ChildKeyValues.Handle, null);
			}

			++unScenarioCount;
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
	console.log("[  OK  ] KeyValues child initialization cleanup: " + unScenarioCount + " independent failure scenarios passed");
}

VerifyKeyValuesConstructionCleanup();
VerifyKeyValuesChildInitializationCleanup();

for (const bSupportsBoolean of [true, false]) {
	const NativeKeyValues = CreateNativeKeyValues({ SupportBoolean: bSupportsBoolean });
	const KeyValuesModule = LoadKeyValues(NativeKeyValues);
	const RootKeyValues = KeyValuesModule.KeyValues.CreateKeyValuesFromObject("SelfAssignment", { Leaf: 73, Child: { Value: 73 }, Other: { Value: 11 } });
	const Clear = NativeKeyValues.Clear;
	let unClearCount = 0;
	NativeKeyValues.Clear = function ClearKeyValues(Handle) {
		unClearCount++;
		return Clear.call(this, Handle);
	};

	try {
		for (const strKeyName of ["Leaf", "Child"]) {
			const SourceKeyValues = RootKeyValues.FindKeyValuesKey(strKeyName);
			const DescendantKeyValues = (strKeyName === "Child") ? SourceKeyValues.FindKeyValuesKey("Value") : null;
			const RootSnapshot = RootKeyValues.ConvertKeyValuesToObject();
			let ResultKeyValues = null;
			try {
				ResultKeyValues = RootKeyValues.SetKeyValuesValue(strKeyName, SourceKeyValues);
				g_Assert.notEqual(ResultKeyValues.Handle, SourceKeyValues.Handle);
				g_Assert.equal(ResultKeyValues.Address, SourceKeyValues.Address);
				g_Assert.equal(unClearCount, 0, "generic assignment of the same native node must not clear it");
				g_Assert.deepEqual(RootKeyValues.ConvertKeyValuesToObject(), RootSnapshot);

				if (DescendantKeyValues !== null) {
					g_Assert.equal(DescendantKeyValues.GetKeyValuesInteger(), 73, "same-node assignment must preserve descendant handles");
				}
			} finally {
				if (ResultKeyValues !== null) {
					ResultKeyValues.DestroyKeyValues();
				}

				if (DescendantKeyValues !== null) {
					DescendantKeyValues.DestroyKeyValues();
				}

				SourceKeyValues.DestroyKeyValues();
			}
		}

		const SourceKeyValues = RootKeyValues.FindKeyValuesKey("Child");
		let ResultKeyValues = null;
		try {
			ResultKeyValues = RootKeyValues.SetKeyValuesValue("Other", SourceKeyValues);
			g_Assert.notEqual(ResultKeyValues.Address, SourceKeyValues.Address);
			g_Assert.equal(ResultKeyValues.GetKeyValuesInteger("Value"), 73);
			g_Assert.equal(SourceKeyValues.GetKeyValuesInteger("Value"), 73);
			g_Assert.equal(unClearCount, 1, "generic copying of distinct nodes must clear the target exactly once");
		} finally {
			if (ResultKeyValues !== null) {
				ResultKeyValues.DestroyKeyValues();
			}

			SourceKeyValues.DestroyKeyValues();
		}
	} finally {
		NativeKeyValues.Clear = Clear;
		RootKeyValues.DestroyKeyValues();
	}

	g_Assert.equal(NativeKeyValues.Debug.HandleCount, 0);
	g_Assert.equal(NativeKeyValues.Debug.NodeCount, 0);
}

const g_NativeKeyValues = CreateNativeKeyValues();
const g_KeyValuesModule = LoadKeyValues(g_NativeKeyValues);
const { KeyValues, KeyValuesIterator } = g_KeyValuesModule;

g_Assert.deepEqual(Object.keys(g_KeyValuesModule).sort(), ["CreateKeyValues", "KeyValues", "KeyValuesIterator", "KeyValuesType"]);
g_Assert.equal(g_KeyValuesModule.KeyValuesType.Color, g_KeyValueType.Color);
g_Assert.equal(Object.isFrozen(g_KeyValuesModule.KeyValuesType), true);
g_Assert.equal(Object.hasOwn(g_KeyValuesModule, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_KeyValuesModule, "default"), false);
g_Assert.equal(Object.hasOwn(g_KeyValuesModule, "KeyValuesIter"), false);

for (const strMethodName of ["GetKeyValuesBoolean", "SetKeyValuesBoolean"]) {
	const MethodDescriptor = Object.getOwnPropertyDescriptor(KeyValues.prototype, strMethodName);
	g_Assert.equal(MethodDescriptor.configurable, true);
	g_Assert.equal(MethodDescriptor.enumerable, false);
	g_Assert.equal(MethodDescriptor.writable, true);
}

const g_TypeInferenceKeyValues = new KeyValues("TypeInference");
try {
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesValue("MinimumInteger", -2147483648));
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesValue("MaximumInteger", 2147483647));
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesValue("MinimumUInt64", 0n));
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesValue("MaximumUInt64", 0xFFFFFFFFFFFFFFFFn));
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesInteger("MinimumInteger"), -2147483648);
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesInteger("MaximumInteger"), 2147483647);
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesUInt64("MinimumUInt64"), 0n);
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesUInt64("MaximumUInt64"), 0xFFFFFFFFFFFFFFFFn);

	const vecNamesBeforeSelfCopy = g_TypeInferenceKeyValues.GetKeyValuesKeyNames();
	g_TypeInferenceKeyValues.CopyKeyValuesRecursively(g_TypeInferenceKeyValues);
	g_Assert.deepEqual(g_TypeInferenceKeyValues.GetKeyValuesKeyNames(), vecNamesBeforeSelfCopy, "copying a KeyValues node to itself must not clear its contents");

	const FirstAlias = g_TypeInferenceKeyValues.FindKeyValuesKey("MaximumInteger");
	const SecondAlias = g_TypeInferenceKeyValues.FindKeyValuesKey("MaximumInteger");
	try {
		g_Assert.notEqual(FirstAlias.Handle, SecondAlias.Handle);
		g_Assert.equal(FirstAlias.Address, SecondAlias.Address);
		g_Assert.strictEqual(FirstAlias.CopyKeyValuesRecursively(SecondAlias), FirstAlias);
		g_Assert.equal(FirstAlias.GetKeyValuesInteger(), 2147483647, "copying distinct handles for the same native node must preserve the value");
	} finally {
		FirstAlias.DestroyKeyValues();
		SecondAlias.DestroyKeyValues();
	}

	for (const nInvalidInteger of [-2147483649, 2147483648, 1e30, -1n, 0x10000000000000000n]) {
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesValue("RejectedInteger", nInvalidInteger), RangeError, "out-of-range generic integers are rejected before creating a child");
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedInteger"), false);
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesValue("MaximumInteger", nInvalidInteger), RangeError, "invalid integer inference must not clear an existing value");
		g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesInteger("MaximumInteger"), 2147483647);
	}

	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesFloat("ExplicitFloat", 2147483648));
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesFloat("ExplicitFloat"), 2147483648);
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesFloat("RoundedFloat", 0.1));
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesFloat("RoundedFloat"), Math.fround(0.1), "KeyValues float storage uses float32 precision");

	for (const dblOverflow of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesFloat("RejectedFloat", dblOverflow), { name: "Error", message: "keyvalues.SetFloat Data expects a value in the finite float32 range." });
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedFloat"), false);
	}

	for (const ColorValue of [
		new g_Color(1, 2, 3),
		[1, 2, 3],
		{ Red: 1, Green: 2, Blue: 3 },
		{ Red: 1, Green: 2, Blue: 3, Alpha: 255 },
	]) {
		DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesValue("CanonicalColor", ColorValue));
		g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesType("CanonicalColor"), g_KeyValueType.Color);

		const ReadColor = g_TypeInferenceKeyValues.GetKeyValuesColor("CanonicalColor");
		g_Assert.equal(ReadColor instanceof g_Color, true, "KeyValues color results use the actual colors module class");
		g_Assert.deepEqual(ReadColor.ConvertColorToArray(), [1, 2, 3, 255]);
	}

	g_Assert.deepEqual(g_TypeInferenceKeyValues.GetKeyValuesColor("MissingColor").ConvertColorToArray(), [0, 0, 0, 255]);
	g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesColor("LegacyColor", { m_unRed: 1, m_unGreen: 2, m_unBlue: 3, m_unAlpha: 255 }), TypeError, "legacy color property aliases are not accepted");
	g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("LegacyColor"), false);

	for (const unInvalidNumber of [0, 1, 4294967296]) {
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesUInt64("RejectedUInt64", unInvalidNumber), TypeError);
		g_Assert.throws(() => g_TypeInferenceKeyValues.GetKeyValuesUInt64("MissingUInt64", unInvalidNumber), TypeError);
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedUInt64"), false);
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesAddress("RejectedAddress", unInvalidNumber), TypeError);
		g_Assert.throws(() => g_TypeInferenceKeyValues.GetKeyValuesAddress("MissingAddress", unInvalidNumber), TypeError);
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedAddress"), false);
	}

	for (const unAddress of [0n, 0xFFFFFFFFFFFFFFFFn]) {
		DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesAddress("BoundaryAddress", unAddress));
		g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesAddress("BoundaryAddress"), unAddress);
	}

	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesAddress("MissingAddress"), 0n);
	g_Assert.equal(g_TypeInferenceKeyValues.GetKeyValuesUInt64("MissingUInt64"), 0n);
	for (const nInvalidBigInt of [-1n, 0x10000000000000000n]) {
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesUInt64("RejectedUInt64", nInvalidBigInt), RangeError);
		g_Assert.throws(() => g_TypeInferenceKeyValues.SetKeyValuesAddress("RejectedAddress", nInvalidBigInt), RangeError);
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedUInt64"), false);
		g_Assert.equal(g_TypeInferenceKeyValues.HasKeyValuesKey("RejectedAddress"), false);
	}

	g_Assert.equal(g_TypeInferenceKeyValues.FindKeyValuesKeyBySymbol(-1), null);
	g_Assert.throws(() => g_TypeInferenceKeyValues.FindKeyValuesKeyBySymbol(2147483648), RangeError);

	for (const InvalidHandle of [0, -1, 1.5, 2147483648, 1n]) {
		g_Assert.throws(() => g_NativeKeyValues.Name({ Handle: InvalidHandle }), { name: "TypeError", message: "A KeyValues native handle is required." });
	}

	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesString("AA", "First"));
	DestroyResult(g_TypeInferenceKeyValues.SetKeyValuesString("BB", "Second"));
	const FirstSymbolKey = g_TypeInferenceKeyValues.FindKeyValuesKey("AA");
	const SecondSymbolKey = g_TypeInferenceKeyValues.FindKeyValuesKey("BB");
	try {
		g_Assert.notEqual(FirstSymbolKey.KeyNameSymbol, SecondSymbolKey.KeyNameSymbol, "equal-length names must retain distinct opaque symbols");
		const FoundSymbolKey = g_TypeInferenceKeyValues.FindKeyValuesKeyBySymbol(SecondSymbolKey.KeyNameSymbol);
		try {
			g_Assert.equal(FoundSymbolKey.Name, "BB", "symbol lookup must select the matching name, not the first equal-length key");
		} finally {
			FoundSymbolKey.DestroyKeyValues();
		}
	} finally {
		SecondSymbolKey.DestroyKeyValues();
		FirstSymbolKey.DestroyKeyValues();
	}
} finally {
	g_TypeInferenceKeyValues.DestroyKeyValues();
}

const g_KeyValuesData = g_KeyValuesModule.CreateKeyValues("SourceJS", {
	Enabled: true,
	Nested: { Label: "keyvalues" },
	Plugin: "smoke",
	RetryCount: 3,
	LiteralBigIntText: "123n",
});

g_Assert.equal(g_NativeKeyValues.Debug.HandleCount, 1, "temporary child handles must be released after object construction");
DestroyResult(g_KeyValuesData.SetKeyValuesFloat("Scale", 1.25));
DestroyResult(g_KeyValuesData.SetKeyValuesUInt64("Big", 4294967296n));
DestroyResult(g_KeyValuesData.SetKeyValuesColor("Color", new g_Color(64, 192, 255, 128)));
DestroyResult(g_KeyValuesData.SetKeyValuesAddress("RawAddress", 0x1234n));
g_Assert.equal(g_KeyValuesData.GetKeyValuesBoolean("Enabled"), true);
g_Assert.equal(g_KeyValuesData.GetKeyValuesString("Plugin"), "smoke");
g_Assert.equal(g_KeyValuesData.GetKeyValuesInteger("RetryCount"), 3);
g_Assert.equal(g_KeyValuesData.GetKeyValuesFloat("Scale"), 1.25);
g_Assert.equal(g_KeyValuesData.GetKeyValuesUInt64("Big"), 4294967296n);
g_Assert.equal(g_KeyValuesData.GetKeyValuesAddress("RawAddress"), 0x1234n);
g_Assert.deepEqual(g_KeyValuesData.GetKeyValuesColor("Color").ConvertColorToArray(), [64, 192, 255, 128]);
g_Assert.equal(g_KeyValuesData.GetKeyValuesType("Nested"), g_KeyValueType.None);
g_Assert.equal(g_KeyValuesData.GetKeyValuesType("Color"), g_KeyValueType.Color);
g_Assert.equal(g_KeyValuesData.GetKeyValuesType("RawAddress"), g_KeyValueType.Address);
g_Assert.equal(typeof g_KeyValuesData.Address, "bigint");
g_Assert.equal(g_KeyValuesData.Name, "SourceJS");
g_KeyValuesData.Name = "SourceJSRuntime";
g_Assert.equal(g_KeyValuesData.Name, "SourceJSRuntime");
g_Assert.equal(Number.isInteger(g_KeyValuesData.KeyNameSymbol), true);
g_Assert.equal(g_KeyValuesData.KeyValuesType, g_KeyValueType.None);
g_Assert.equal(g_KeyValuesData.GetKeyValuesValue("Nested").Label, "keyvalues");
g_Assert.equal(g_KeyValuesData.HasKeyValuesKey("Plugin"), true);
g_Assert.equal(g_KeyValuesData.HasKeyValuesKey("Missing"), false);
g_Assert.equal(g_KeyValuesData.GetKeyValuesKeyOrDefault("Missing", null), null);
g_Assert.strictEqual(g_KeyValuesData.GetKeyValuesKeyOrDefault(null), g_KeyValuesData);
g_Assert.deepEqual(g_KeyValuesData.KeyValuesValue, g_KeyValuesData.ConvertKeyValuesToObject());
g_Assert.deepEqual(g_KeyValuesData.DirectChildValues, g_KeyValuesData.ConvertKeyValuesToObject());
g_Assert.deepEqual(g_KeyValuesData.GetKeyValuesEntries(), g_KeyValuesData.GetKeyValuesKeyNames().map((strName) => [strName, g_KeyValuesData.GetKeyValuesValue(strName)]));
g_Assert.deepEqual(g_KeyValuesData.GetKeyValuesValueList(), g_KeyValuesData.GetKeyValuesKeyNames().map((strName) => g_KeyValuesData.GetKeyValuesValue(strName)));

CheckDuplicateKeyValuesConversion(KeyValues);

const g_PrototypeKeyValues = new KeyValues("Prototype");
DestroyResult(g_PrototypeKeyValues.SetKeyValuesString("__proto__", "data property"));

const g_PrototypeObject = g_PrototypeKeyValues.ConvertKeyValuesToObject();
g_Assert.strictEqual(Object.getPrototypeOf(g_PrototypeObject), Object.prototype);
g_Assert.equal(Object.hasOwn(g_PrototypeObject, "__proto__"), true);
g_Assert.equal(g_PrototypeObject.__proto__, "data property");
g_PrototypeKeyValues.DestroyKeyValues();

const g_FirstValue = g_KeyValuesData.FirstValueKeyValues;
const g_FirstTrueSubKey = g_KeyValuesData.FirstTrueSubKeyValues;
g_Assert.equal(g_FirstValue.Name, "Enabled");
g_Assert.equal(g_FirstValue.NextValueKeyValues.Name, "Plugin");
g_Assert.equal(g_FirstTrueSubKey.Name, "Nested");
g_Assert.equal(g_FirstTrueSubKey.NextTrueSubKeyValues, null);
g_FirstValue.NextValueKeyValues.DestroyKeyValues();
g_FirstValue.DestroyKeyValues();
g_FirstTrueSubKey.DestroyKeyValues();
g_Assert.deepEqual([...g_KeyValuesData], g_KeyValuesData.GetKeyValuesKeyNames());

const g_LiveIteratorRoot = KeyValues.CreateKeyValuesFromObject("Iterator", { First: 1, Second: 2 });
const g_itLiveIterator = new KeyValuesIterator(g_LiveIteratorRoot);
g_Assert.equal(Object.hasOwn(g_itLiveIterator, "m_NextKeyValues"), false, "iterator implementation state is private");
g_Assert.equal(g_itLiveIterator.NextKeyValues.Name, "First", "the public next-value accessor is retained");
g_Assert.throws(() => {
	g_itLiveIterator.NextKeyValues = null;
}, TypeError, "the next-value accessor remains read-only");
g_Assert.deepEqual(g_itLiveIterator.next(), { done: false, value: "First" });
DestroyResult(g_LiveIteratorRoot.SetKeyValuesInteger("Third", 3));
g_Assert.deepEqual(g_itLiveIterator.next(), { done: false, value: "Second" });
g_Assert.deepEqual(g_itLiveIterator.next(), { done: false, value: "Third" });
g_Assert.deepEqual(g_itLiveIterator.next(), { done: true, value: undefined });
g_Assert.strictEqual(g_itLiveIterator[Symbol.iterator](), g_itLiveIterator);

const g_itEarlyIterator = new KeyValuesIterator(g_LiveIteratorRoot);
g_Assert.deepEqual(g_itEarlyIterator.return(), { done: true, value: undefined });
g_LiveIteratorRoot.DestroyKeyValues();

const g_Copy = g_KeyValuesData.CreateKeyValuesCopy();
DestroyResult(g_Copy.SetKeyValuesString("Plugin", "copy"));
g_Assert.equal(g_KeyValuesData.GetKeyValuesString("Plugin"), "smoke");
g_Assert.equal(g_Copy.GetKeyValuesString("Plugin"), "copy");

const g_RecursiveTarget = KeyValues.CreateKeyValuesFromObject("Target", { Stale: true });
g_RecursiveTarget.CopyKeyValuesRecursively(g_KeyValuesData);
g_Assert.equal(g_RecursiveTarget.HasKeyValuesKey("Stale"), false);
g_Assert.equal(g_RecursiveTarget.GetKeyValuesString("Plugin"), "smoke");

const g_CreatedKey = g_RecursiveTarget.CreateKeyValuesKey();
g_CreatedKey.SetKeyValuesString(null, "Numbered");
g_Assert.equal(g_CreatedKey.KeyValuesValue, "Numbered");
g_CreatedKey.DestroyKeyValues();

const g_SymbolReference = g_RecursiveTarget.FindKeyValuesKey("Plugin");
const g_SymbolKey = g_RecursiveTarget.FindKeyValuesKeyBySymbol(g_SymbolReference.KeyNameSymbol);
g_Assert.equal(typeof g_SymbolKey.Name, "string");
g_SymbolKey.DestroyKeyValues();
g_SymbolReference.DestroyKeyValues();

const g_DetachedChild = KeyValues.CreateKeyValuesFromObject("Detached", { Value: 10 });
g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_DetachedChild.Handle), true);
g_Assert.strictEqual(g_RecursiveTarget.AddKeyValuesSubKey(g_DetachedChild), g_DetachedChild);
g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_DetachedChild.Handle), false);
g_Assert.equal(g_RecursiveTarget.RemoveKeyValuesSubKey(g_DetachedChild), true);
g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_DetachedChild.Handle), true);
g_Assert.equal(g_DetachedChild.GetKeyValuesInteger("Value"), 10);
g_DetachedChild.DestroyKeyValues();

const g_CycleRoot = KeyValues.CreateKeyValuesFromObject("CycleRoot", { Parent: { Child: 1 } });
const g_CycleDescendant = g_CycleRoot.FindKeyValuesKey("Parent");
try {
	g_Assert.throws(() => g_CycleDescendant.AddKeyValuesSubKey(g_CycleRoot), /distinct owned/);
	g_Assert.throws(() => {
		g_CycleDescendant.NextKeyValues = g_CycleRoot;
	}, /distinct owned/);
	g_Assert.deepEqual(g_CycleRoot.GetKeyValuesKeyNames(), ["Parent"]);
	g_Assert.deepEqual(g_CycleDescendant.GetKeyValuesKeyNames(), ["Child"]);
	g_Assert.equal(g_CycleDescendant.NextKeyValues, null);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_CycleRoot.Handle), true);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_CycleDescendant.Handle), false);
} finally {
	g_CycleDescendant.DestroyKeyValues();
	g_CycleRoot.DestroyKeyValues();
}

function VerifyKeyValuesFloatCoercionLifetime() {
	for (const bWrite of [false, true]) {
		const LiveRoot = new KeyValues("FloatCoercion");
		let unConversionCount = 0;
		const ConvertedValue = {
			valueOf() {
				unConversionCount += 1;

				return 12.5;
			},
		};
		try {
			if (bWrite) {
				g_Assert.equal(g_NativeKeyValues.SetFloat(LiveRoot.Handle, null, ConvertedValue), true);
				g_Assert.equal(LiveRoot.GetKeyValuesFloat(), 12.5);

			} else {
				g_Assert.equal(g_NativeKeyValues.GetFloat(LiveRoot.Handle, "Missing", ConvertedValue), 12.5);
			}

			g_Assert.equal(unConversionCount, 1);
		} finally {
			LiveRoot.DestroyKeyValues();
		}

		const DeletedRoot = new KeyValues("DeletedFloatCoercion");
		const unRawHandle = DeletedRoot.Handle.Handle;
		const unNodeCountBeforeDelete = g_NativeKeyValues.Debug.NodeCount;
		let unHandleReadCount = 0;
		let unDeletionConversionCount = 0;
		const HandleValue = {
			get Handle() {
				unHandleReadCount += 1;

				return unRawHandle;
			},
		};
		const DeletingValue = {
			valueOf() {
				unDeletionConversionCount += 1;
				DeletedRoot.DestroyKeyValues();

				return 1.5;
			},
		};
		try {
			g_Assert.throws(() => {
				if (bWrite) {
					g_NativeKeyValues.SetFloat(HandleValue, "Forbidden", DeletingValue);

				} else {
					g_NativeKeyValues.GetFloat(HandleValue, "Missing", DeletingValue);
				}
			}, /invalidated by a float conversion/);
			g_Assert.equal(unHandleReadCount, 1);
			g_Assert.equal(unDeletionConversionCount, 1);
			g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, unNodeCountBeforeDelete - 1);
		} finally {
			DeletedRoot.DestroyKeyValues();
		}

		for (const Failure of [
			undefined,
			null,
			Symbol("float conversion"),
			new Error("Controlled float conversion failure."),
		]) {
			const PreservedRoot = new KeyValues("PreservedFloatCoercion");
			const FailingValue = {
				valueOf() {
					throw Failure;
				},
			};
			let bCaught = false;
			try {
				try {
					if (bWrite) {
						g_NativeKeyValues.SetFloat(PreservedRoot.Handle, "Forbidden", FailingValue);

					} else {
						g_NativeKeyValues.GetFloat(PreservedRoot.Handle, "Missing", FailingValue);
					}
				} catch (ErrorValue) {
					bCaught = true;
					g_Assert.strictEqual(ErrorValue, Failure);
				}

				g_Assert.equal(bCaught, true);
				g_Assert.equal(PreservedRoot.IsKeyValuesEmpty(), true);
			} finally {
				PreservedRoot.DestroyKeyValues();
			}
		}
	}
}

VerifyKeyValuesFloatCoercionLifetime();

const g_RawCopySource = KeyValues.CreateKeyValuesFromObject("RawCopySource", { Original: { Value: 11 } });
const g_RawCopyTarget = KeyValues.CreateKeyValuesFromObject("RawCopyTarget", { Retained: 22 });
const g_RawCopyEmptyTarget = new KeyValues("RawCopyEmptyTarget");
const g_RawCopySourceChild = g_RawCopySource.FindKeyValuesKey("Original");
const g_RawCopySourceChildAlias = g_RawCopySource.FindKeyValuesKey("Original");
try {
	const unNodeCountBeforeCopy = g_NativeKeyValues.Debug.NodeCount;
	g_Assert.equal(g_NativeKeyValues.CopySubKeys(g_RawCopySource.Handle, g_RawCopySource.Handle), true);
	g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, unNodeCountBeforeCopy);
	g_Assert.deepEqual(g_RawCopySource.GetKeyValuesKeyNames(), ["Original"]);
	g_Assert.equal(g_NativeKeyValues.CopySubKeys(g_RawCopySourceChild.Handle, g_RawCopySourceChildAlias.Handle), true);
	g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, unNodeCountBeforeCopy);
	g_Assert.throws(() => g_NativeKeyValues.CopySubKeys(g_RawCopySource.Handle, g_RawCopyTarget.Handle), /without subkeys/);
	g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, unNodeCountBeforeCopy);
	g_Assert.equal(g_RawCopyTarget.GetKeyValuesInteger("Retained"), 22);
	g_Assert.equal(g_RawCopySourceChild.GetKeyValuesInteger("Value"), 11);
	g_Assert.equal(g_NativeKeyValues.CopySubKeys(g_RawCopySource.Handle, g_RawCopyEmptyTarget.Handle), true);
	g_Assert.deepEqual(g_RawCopyEmptyTarget.ConvertKeyValuesToObject(), { Original: { Value: 11 } });
	g_Assert.equal(g_RawCopySource.RemoveKeyValuesSubKey(g_RawCopySourceChild), true);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_RawCopySourceChild.Handle), true);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_RawCopySourceChildAlias.Handle), false);
	g_Assert.equal(g_RawCopySourceChildAlias.DestroyKeyValues(), true);
	g_Assert.equal(g_RawCopySourceChild.GetKeyValuesInteger("Value"), 11);
} finally {
	g_RawCopySourceChildAlias.DestroyKeyValues();
	g_RawCopySourceChild.DestroyKeyValues();
	g_RawCopyEmptyTarget.DestroyKeyValues();
	g_RawCopyTarget.DestroyKeyValues();
	g_RawCopySource.DestroyKeyValues();
}

const g_OwnedPeerParent = KeyValues.CreateKeyValuesFromObject("OwnedPeerParent", { Existing: 1 });
const g_OwnedPeerChild = KeyValues.CreateKeyValuesFromObject("OwnedPeerChild", { Value: 16 });
const g_OwnedPeerSibling = KeyValues.CreateKeyValuesFromObject("OwnedPeerSibling", { Value: 32 });
let g_RejectedChildNextPeer = null;
try {
	g_OwnedPeerChild.NextKeyValues = g_OwnedPeerSibling;
	g_Assert.throws(() => g_OwnedPeerParent.AddKeyValuesSubKey(g_OwnedPeerChild), /without a next peer/);
	g_Assert.deepEqual(g_OwnedPeerParent.GetKeyValuesKeyNames(), ["Existing"]);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_OwnedPeerChild.Handle), true);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_OwnedPeerSibling.Handle), false);
	g_RejectedChildNextPeer = g_OwnedPeerChild.NextKeyValues;
	g_Assert.equal(g_RejectedChildNextPeer.Address, g_OwnedPeerSibling.Address);
	g_Assert.equal(g_RejectedChildNextPeer.GetKeyValuesInteger("Value"), 32);
	g_Assert.equal(g_OwnedPeerChild.GetKeyValuesInteger("Value"), 16);
	g_OwnedPeerChild.NextKeyValues = null;
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_OwnedPeerSibling.Handle), true);
	g_Assert.strictEqual(g_OwnedPeerParent.AddKeyValuesSubKey(g_OwnedPeerChild), g_OwnedPeerChild);
	g_Assert.deepEqual(g_OwnedPeerParent.GetKeyValuesKeyNames(), ["Existing", "OwnedPeerChild"]);
	g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_OwnedPeerChild.Handle), false);
} finally {
	if (g_RejectedChildNextPeer !== null) {
		g_RejectedChildNextPeer.DestroyKeyValues();
	}

	g_OwnedPeerSibling.DestroyKeyValues();
	g_OwnedPeerChild.DestroyKeyValues();
	g_OwnedPeerParent.DestroyKeyValues();
}

const g_PeerRoot = KeyValues.CreateKeyValuesFromObject("Peers", { First: 1, Second: 2 });
const g_FirstPeer = g_PeerRoot.FirstSubKeyValues;
const g_PreviousSecondPeer = g_FirstPeer.NextKeyValues;
const g_ReplacementPeer = KeyValues.CreateKeyValuesFromObject("Replacement", { Active: true });
g_FirstPeer.NextKeyValues = g_ReplacementPeer;
g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_PreviousSecondPeer.Handle), true);
g_Assert.equal(g_NativeKeyValues.Debug.IsHandleOwned(g_ReplacementPeer.Handle), false);
g_Assert.deepEqual(g_PeerRoot.GetKeyValuesKeyNames(), ["First", "Replacement"]);
g_PreviousSecondPeer.DestroyKeyValues();
g_ReplacementPeer.DestroyKeyValues();
g_FirstPeer.DestroyKeyValues();
g_PeerRoot.DestroyKeyValues();

const g_PeerDiscardRoot = KeyValues.CreateKeyValuesFromObject("PeerDiscard", { First: 1, Second: 2 });
const g_PeerDiscardFirst = g_PeerDiscardRoot.FirstSubKeyValues;
const g_unNodeCountBeforeDiscard = g_NativeKeyValues.Debug.NodeCount;
g_PeerDiscardFirst.NextKeyValues = null;
g_Assert.deepEqual(g_PeerDiscardRoot.GetKeyValuesKeyNames(), ["First"]);
g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, g_unNodeCountBeforeDiscard - 1);
g_PeerDiscardFirst.DestroyKeyValues();
g_PeerDiscardRoot.DestroyKeyValues();

const g_InvalidPeerRoot = KeyValues.CreateKeyValuesFromObject("InvalidPeer", { First: 1, Second: 2 });
const g_InvalidPeerFirst = g_InvalidPeerRoot.FirstSubKeyValues;
const g_InvalidPeerSecond = g_InvalidPeerFirst.NextKeyValues;
const g_InvalidPeerHolder = KeyValues.CreateKeyValuesFromObject("Holder", { Nested: { Value: 1 } });
const g_InvalidPeerCandidate = g_InvalidPeerHolder.FirstSubKeyValues;
g_Assert.throws(() => {
	g_InvalidPeerFirst.NextKeyValues = g_InvalidPeerCandidate;
}, /owned next-key tree/);
g_InvalidPeerCandidate.DestroyKeyValues();
g_InvalidPeerHolder.DestroyKeyValues();
g_InvalidPeerSecond.DestroyKeyValues();
g_InvalidPeerFirst.DestroyKeyValues();
g_InvalidPeerRoot.DestroyKeyValues();

const g_StaleRoot = KeyValues.CreateKeyValuesFromObject("Stale", { Nested: { Value: 1 } });
const g_StaleChild = g_StaleRoot.FindKeyValuesKey("Nested");
g_StaleRoot.ClearKeyValues();
g_Assert.throws(() => g_StaleChild.Name, /Unknown KeyValues native handle/);
g_Assert.equal(g_StaleRoot.IsKeyValuesEmpty(), true);
g_StaleChild.DestroyKeyValues();
g_StaleRoot.DestroyKeyValues();

const g_DeleteRoot = KeyValues.CreateKeyValuesFromObject("Delete", { RemoveMe: 1 });
g_Assert.equal(g_DeleteRoot.DeleteKeyValuesKey("RemoveMe"), true);
g_Assert.equal(g_DeleteRoot.HasKeyValuesKey("RemoveMe"), false);
g_Assert.throws(() => g_DeleteRoot.DeleteKeyValuesKey("RemoveMe"), /does not exist/);
g_DeleteRoot.DestroyKeyValues();

const g_strSerialized = g_KeyValuesData.ConvertKeyValuesToString();
const g_Parsed = KeyValues.CreateKeyValuesFromBuffer(g_strSerialized, true);
g_Assert.equal(g_Parsed.Name, "SourceJSRuntime");
g_Assert.equal(g_Parsed.GetKeyValuesString("Plugin"), "smoke");
g_Assert.equal(g_Parsed.GetKeyValuesString("LiteralBigIntText"), "123n", "ordinary strings are not decoded as BigInt values");
g_Assert.equal(g_Parsed.GetKeyValuesAddress("RawAddress"), 0x1234n);
g_Assert.equal(g_Parsed.GetKeyValuesUInt64("Big"), 4294967296n);
g_Assert.equal(g_NativeKeyValues.Debug.Calls.some((vecEntry) => (vecEntry[0] === "LoadFromBuffer") && (vecEntry[2] === true)), true);
g_Assert.equal(g_Parsed.SaveKeyValuesToFile("cfg/sourcejs/keyvalues-smoke.kv"), true);

const g_StaleFileChild = g_Parsed.FindKeyValuesKey("Nested");
g_Assert.equal(g_Parsed.LoadKeyValuesFromFileInPlace("cfg/sourcejs/keyvalues-smoke.kv", { UseEscapeSequences: false }), true);
g_Assert.throws(() => g_StaleFileChild.Name, /Unknown KeyValues native handle/);
g_StaleFileChild.DestroyKeyValues();

const g_vecFailedLoadScenarios = [
	{
		Name: "Buffer",
		LoadFailure: RootKeyValues => RootKeyValues.LoadKeyValuesFromBufferInPlace("{"),
		LoadValidationFailure: RootKeyValues => RootKeyValues.LoadKeyValuesFromBufferInPlace(42),
	},
	{
		Name: "File",
		LoadFailure: RootKeyValues => RootKeyValues.LoadKeyValuesFromFileInPlace("cfg/sourcejs/missing-keyvalues-smoke.kv"),
		LoadValidationFailure: RootKeyValues => RootKeyValues.LoadKeyValuesFromFileInPlace("file.vdf", { Unknown: true }),
	},
];

for (const LoadScenario of g_vecFailedLoadScenarios) {
	const RootKeyValues = KeyValues.CreateKeyValuesFromObject(`Failed${LoadScenario.Name}Load`, { Nested: { Value: 1 } });
	const ChildKeyValues = RootKeyValues.FindKeyValuesKey("Nested");

	try {
		g_Assert.throws(() => LoadScenario.LoadValidationFailure(RootKeyValues), TypeError);
		g_Assert.equal(ChildKeyValues.Name, "Nested", `${LoadScenario.Name} preflight failure must preserve descendant handles`);
		g_Assert.equal(LoadScenario.LoadFailure(RootKeyValues), false);
		g_Assert.throws(() => ChildKeyValues.Name, /Unknown KeyValues native handle/, `${LoadScenario.Name} loader failure must invalidate descendant handles`);
		g_Assert.ok(RootKeyValues.Address > 0n, "a failed in-place load must not release the root handle");
		g_Assert.equal(ChildKeyValues.DestroyKeyValues(), false);
		g_Assert.equal(ChildKeyValues.Handle, null);
		g_Assert.equal(ChildKeyValues.DestroyKeyValues(), false);
	} finally {
		ChildKeyValues.DestroyKeyValues();
		RootKeyValues.DestroyKeyValues();
	}
}

const g_Loaded = KeyValues.CreateKeyValuesFromFile("cfg/sourcejs/keyvalues-smoke.kv", { UseEscapeSequences: true });
g_Assert.equal(g_Loaded.GetKeyValuesString("Plugin"), "smoke");
g_Assert.equal(g_Loaded.SetKeyValuesEscapeSequencesEnabled(), true);
g_Assert.equal(g_Loaded.SetKeyValuesEscapeSequencesEnabled(false), false);
g_Assert.throws(() => g_Loaded.SetKeyValuesEscapeSequencesEnabled("yes"), /boolean/);
g_Assert.throws(() => g_Loaded.LoadKeyValuesFromFileInPlace("file.vdf", true), /LoadOptions must be an object/);
g_Assert.throws(() => g_Loaded.LoadKeyValuesFromFileInPlace("file.vdf", { Unknown: true }), /Unknown KeyValues.LoadKeyValuesFromFileInPlace option/);
g_Assert.throws(() => KeyValues.CreateKeyValuesFromBuffer("not-keyvalues"), /Could not parse/);
g_Assert.throws(() => KeyValues.CreateKeyValuesFromFile("missing.kv"), /Could not load/);

for (const InvalidColor of [
	[1, 2],
	[1, 2, 300],
	{ Red: 1, Green: 2 },
	null,
]) {
	g_Assert.throws(() => g_Loaded.SetKeyValuesColor("Color", InvalidColor), /Color|color/);
}

g_Assert.throws(() => g_Loaded.SetKeyValuesValue("Infinite", Infinity), /finite numbers/);
g_Assert.throws(() => g_Loaded.SetKeyValuesValue("Symbol", Symbol("Value")), /KeyValues values/);
g_Assert.throws(() => g_Loaded.SetKeyValuesAddress("Address", "0x1234"), /BigInt address/);
g_Assert.throws(() => g_Loaded.SetKeyValuesString("Text", 10), /string/);
g_Assert.throws(() => g_Loaded.SetKeyValuesInteger("Count", 1.5), /integer/);
g_Assert.throws(() => g_Loaded.SetKeyValuesUInt64("Large", -1n), /unsigned 64-bit/);
g_Assert.throws(() => g_Loaded.SetKeyValuesFloat("Scale", NaN), /finite/);
g_Assert.throws(() => g_Loaded.SetKeyValuesBoolean("Enabled", 1), /boolean/);
g_Assert.throws(() => g_Loaded.FindKeyValuesKey(10), /string/);
g_Assert.throws(() => g_Loaded.FindKeyValuesKey("Name", 1), /boolean/);
g_Assert.throws(() => g_Loaded.AddKeyValuesObject([]), /plain object/);
g_Assert.throws(() => g_Loaded.AddKeyValuesSubKey({}), /KeyValues instance/);
g_Assert.throws(() => g_Loaded.RemoveKeyValuesSubKey({}), /KeyValues instance/);
g_Assert.throws(() => g_Loaded.CopyKeyValuesRecursively({}), /KeyValues instance/);

const g_ContextRoot = new KeyValues("ContextOwner");
g_NativeKeyValues.Debug.SetPlugin("other-plugin");
g_Assert.throws(() => g_ContextRoot.Name, /another plugin context/);
g_NativeKeyValues.Debug.SetPlugin("keyvalues-smoke");
g_ContextRoot.DestroyKeyValues();

const g_UnloadRoot = KeyValues.CreateKeyValuesFromObject("Unload", { Child: { Value: 1 } });
const g_UnloadChild = g_UnloadRoot.FindKeyValuesKey("Child");
g_NativeKeyValues.Debug.ReleasePlugin("keyvalues-smoke");
g_Assert.equal(g_NativeKeyValues.Debug.HandleCount, 0);
g_Assert.equal(g_NativeKeyValues.Debug.NodeCount, 0);
g_Assert.throws(() => g_UnloadRoot.Name, /Unknown KeyValues native handle/);
g_Assert.throws(() => g_UnloadChild.Name, /Unknown KeyValues native handle/);

const g_ReducedNativeKeyValues = CreateNativeKeyValues({ SupportBoolean: false });
const g_ReducedKeyValuesModule = LoadKeyValues(g_ReducedNativeKeyValues);
const g_ReducedRoot = g_ReducedKeyValuesModule.KeyValues.CreateKeyValuesFromObject("Reduced", { Value: 1 });
g_Assert.equal(Object.hasOwn(g_ReducedKeyValuesModule.KeyValues.prototype, "GetKeyValuesBoolean"), false);
g_Assert.equal(Object.hasOwn(g_ReducedKeyValuesModule.KeyValues.prototype, "SetKeyValuesBoolean"), false);
g_Assert.throws(() => g_ReducedRoot.GetKeyValuesBoolean("Value"), TypeError);
g_Assert.throws(() => g_ReducedRoot.SetKeyValuesValue("Enabled", true), TypeError);
g_ReducedRoot.DestroyKeyValues();
g_Assert.equal(g_ReducedNativeKeyValues.Debug.HandleCount, 0);
g_Assert.equal(g_ReducedNativeKeyValues.Debug.NodeCount, 0);

const g_DocumentationNativeKeyValues = CreateNativeKeyValues();
const g_DocumentationKeyValues = LoadKeyValues(g_DocumentationNativeKeyValues);
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecExamples = ExtractDocumentationBlocks(g_strDocumentation);

const g_DocumentationFileSystem = {
	DoesFileExist(strFileName) {
		return g_DocumentationNativeKeyValues.Debug.Files.has(strFileName);
	},

	RemoveFile(strFileName) {
		return g_DocumentationNativeKeyValues.Debug.Files.delete(strFileName);
	},
};

const g_DocumentationGlobals = {
	GetGlobalVariables() {
		return { MapName: "sdk_test_map", Address: 0x210000n, StartSpot: "landmark" };
	},
};

const g_DocumentationModules = {
	colors: { Color: g_Color },
	filesystem: g_DocumentationFileSystem,
	globals: g_DocumentationGlobals,
	keyvalues: g_DocumentationKeyValues,
};

g_Assert.equal(g_vecExamples.length, 15, "keyvalues documentation must contain fifteen executable JavaScript blocks");
VerifyKeyValuesDocumentationCleanup(g_vecExamples, g_DocumentationGlobals);

for (const strExampleSource of g_vecExamples) {
	RunKeyValuesDocumentationExample(strExampleSource, g_DocumentationModules);
	g_Assert.equal(g_DocumentationNativeKeyValues.Debug.HandleCount, 0, "Each documentation example must release every KeyValues handle");
	g_Assert.equal(g_DocumentationNativeKeyValues.Debug.NodeCount, 0, "Each documentation example must release every KeyValues tree");
}

for (const strExportName of ["KeyValuesType", "KeyValues", "KeyValuesIterator", "CreateKeyValues"]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `Documentation must cover ${strExportName}`);
}

for (const strMemberName of [
	"AddKeyValuesObject",
	"AddKeyValuesSubKey",
	"ClearKeyValues",
	"CreateKeyValuesKey",
	"DeleteKeyValuesKey",
	"DestroyKeyValues",
	"GetKeyValuesEntries",
	"FindKeyValuesKey",
	"FindKeyValuesKeyBySymbol",
	"FirstSubKeyValues",
	"FirstTrueSubKeyValues",
	"FirstValueKeyValues",
	"CreateKeyValuesFromBuffer",
	"LoadKeyValuesFromBufferInPlace",
	"CreateKeyValuesFromFile",
	"LoadKeyValuesFromFileInPlace",
	"CreateKeyValuesFromObject",
	"GetKeyValuesValue",
	"GetKeyValuesBoolean",
	"GetKeyValuesColor",
	"GetKeyValuesType",
	"GetKeyValuesFloat",
	"GetKeyValuesInteger",
	"GetKeyValuesAddress",
	"GetKeyValuesString",
	"GetKeyValuesUInt64",
	"Handle",
	"HasKeyValuesKey",
	"IsKeyValuesEmpty",
	"GetKeyValuesKeyOrDefault",
	"GetKeyValuesKeyNames",
	"CreateKeyValuesCopy",
	"Name",
	"KeyNameSymbol",
	"NextKeyValues",
	"NextTrueSubKeyValues",
	"NextValueKeyValues",
	"Address",
	"CopyKeyValuesRecursively",
	"RemoveKeyValuesSubKey",
	"return",
	"SaveKeyValuesToFile",
	"SetKeyValuesValue",
	"SetKeyValuesBoolean",
	"SetKeyValuesColor",
	"SetKeyValuesFloat",
	"SetKeyValuesInteger",
	"SetKeyValuesAddress",
	"SetKeyValuesString",
	"SetKeyValuesUInt64",
	"ConvertKeyValuesToObject",
	"ConvertKeyValuesToString",
	"KeyValuesType",
	"SetKeyValuesEscapeSequencesEnabled",
	"KeyValuesValue",
	"GetKeyValuesValueList",
	"DirectChildValues",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `Documentation must cover ${strMemberName}`);
}

for (const vecMatch of g_strDocumentation.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
	const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), vecMatch[1]);
	g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `Documentation link does not exist: ${vecMatch[1]}`);
}

for (const strForbiddenTerm of [
	"Generated by",
	"generate_api_docs",
	"console.log(instance)",
	"console.log(result)",
	"sourcejs:example",
	"fromHandle",
	"getUint64",
	"setUint64",
	"addressString",
]) {
	g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `Documentation must not contain ${strForbiddenTerm}`);
}

g_Assert.doesNotMatch(g_strDocumentation, /\bKeyValuesIter\b/);

const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_nKeyValuesBindingsStart = g_strNativeBindings.indexOf("struct KeyValuesRecord");
g_Assert.ok(g_nKeyValuesBindingsStart >= 0, "Missing native KeyValues contract region start");
const g_nKeyValuesBindingsEnd = g_strNativeBindings.indexOf("v8::Local<v8::Object> const LocalBitBuffersModule = MakeModule(pIsolate);", g_nKeyValuesBindingsStart);
g_Assert.ok(g_nKeyValuesBindingsEnd > g_nKeyValuesBindingsStart, "Missing native KeyValues contract region end");
const g_strKeyValuesBindings = g_strNativeBindings.slice(g_nKeyValuesBindingsStart, g_nKeyValuesBindingsEnd);

// Report the missing contract without dumping the entire native source on an assertion failure.
for (const Pattern of [
	/std::string m_strPluginName/,
	/RequireCurrentPluginNameForKeyValues/,
	/CollectKeyValuesHierarchy/,
	/EraseDescendantKeyValuesRecords/,
	/DestroyKeyValuesHierarchy/,
	/ReleaseKeyValuesRecordsForPlugin/,
	/KeyValues ownership transfer requires an owned root handle/,
	/expects Child to be a distinct owned tree/,
	/expects Next to be a distinct owned next-key tree or null/,
	/nPreviousNextKeyValuesOwnerHandle/,
	/CollectKeyValuesHierarchy\(pPreviousNextKeyValues,\s*vecPreviousNextHierarchy\)/,
	/EraseCollectedKeyValuesRecords\(vecPreviousNextHierarchy\)/,
	/InstallKeyValuesGetBooleanFunction<KeyValues>/,
	/InstallKeyValuesSetBooleanFunction<KeyValues>/,
]) {
	g_Assert.equal(Pattern.test(g_strKeyValuesBindings), true, `Missing native KeyValues contract: ${Pattern}`);
}

for (const Pattern of [/GetBool is unavailable/, /SetBool is unavailable/]) {
	g_Assert.equal(Pattern.test(g_strKeyValuesBindings), false, `Unexpected native KeyValues contract: ${Pattern}`);
}

for (const strLoadOperation of ["Buffer", "File"]) {
	const strCallbackName = `LoadKeyValuesFrom${strLoadOperation}Callback`;
	const nCallbackStart = g_strKeyValuesBindings.indexOf(`\tvoid ${strCallbackName}(`);
	g_Assert.ok(nCallbackStart >= 0, `Missing native ${strCallbackName}`);

	const nCallbackEnd = g_strKeyValuesBindings.indexOf("\n\t}", nCallbackStart);
	g_Assert.ok(nCallbackEnd > nCallbackStart, `Missing end of native ${strCallbackName}`);

	const strCallback = g_strKeyValuesBindings.slice(nCallbackStart, nCallbackEnd);
	const nFileSystemValidation = strCallback.indexOf("RequireFilesystemInterface(pIsolate)");
	const nDescendantInvalidation = strCallback.indexOf("EraseDescendantKeyValuesRecords(pKeyValues);");
	const nSDKLoad = strCallback.indexOf(`LoadSourceSDKKeyValuesFrom${strLoadOperation}(`);
	g_Assert.ok((nFileSystemValidation >= 0) && (nDescendantInvalidation > nFileSystemValidation) && (nSDKLoad > nDescendantInvalidation), `${strCallbackName} must invalidate descendant handles after validation and before the SDK loader, including loader failure`);
}

g_Assert.throws(() => LoadKeyValues(), (ErrorValue) => (ErrorValue.constructor === Error) && (ErrorValue.code !== "MODULE_NOT_FOUND") && (ErrorValue.message === "SourceJS native runtime is not installed."));

console.log("[  OK  ] keyvalues smoke passed");
