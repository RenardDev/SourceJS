# `require("autodoc")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`SphinxProject`](#sphinxproject)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

Use a dedicated writable output directory, such as `addons/sourcejs/data/sourcejs/autodoc` in an installed server. Do not point `SphinxProject` at the shipped, hand-maintained `addons/sourcejs/docs/sourcejs/api` tree.

Module index: [SourceJS API Reference](README.md)

## Location and purpose

The implementation lives in [`packages/sourcejs/autodoc.js`](../../packages/sourcejs/autodoc.js), and [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs native `autodoc.GetModuleNames`. Use the package to discover installed native module names and generate a separate documentation tree for a SourceJS package. It writes Sphinx-compatible configuration and reStructuredText plus a standalone HTML module index; it does not invoke a Sphinx executable or run an external build process. Generated module pages contain module names and import examples, not complete per-export API contracts.

## Import

```js
const { MODULE_NAME } = require("autodoc");

console.log(MODULE_NAME);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`SphinxError`](#sphinxerror) | Class | `new SphinxError(strMessage = "Unable to create, generate or build documentation.")` |
| [`SphinxProject`](#sphinxproject-1) | Class | `new SphinxProject(strPackageDirectory, strProjectDirectory)` |
| [`MODULE_NAME`](#module_name) | Constant | String value: `"autodoc"`. |
| [`GetModuleNames`](#getmodulenames) | Function | `GetModuleNames()`; copies and lexically sorts the native list of own string-named, object-valued properties of the SourceJS object, excluding functions. Missing runtime, context, or SourceJS object yields an empty native list. Enumeration or property-access exceptions can propagate; this is not a catch-all empty-array fallback. |

## `SphinxProject`

| Class or member | Signature or behavior |
| --- | --- |
| `SphinxProject` | `new SphinxProject(strPackageDirectory, strProjectDirectory)`; coerces both paths to strings, normalizes slash spelling, and immediately checks whether the package path exists. This is lexical normalization, not resolution of `..` or symbolic links. The existence check does not verify that the path is a directory. |
| Constructor paths | Normalized paths are stored internally; the class does not expose `PackageDirectory` or `ProjectDirectory` properties. Use `ProjectSourceDirectory` and `ProjectBuildDirectory` for the derived public paths. |
| `ProjectSourceDirectory` / `ProjectBuildDirectory` | Read-only `<project>/source` and `<project>/build` getters. |
| `DoesPackageExist` / `DoesProjectExist` | Check the corresponding normalized path through `filesystem.DoesFileExist`. |
| [`CreateProject`](#sphinxprojectcreateproject) | `CreateProject(strAuthor, strProjectName = null, strVersion = "1")`; rejects an existing project path, creates source/build directories, `conf.py`, and `index.rst`, then returns `true`. Writes are not transactional; failure can leave partial output. |
| [`GenerateProjectFiles`](#sphinxprojectgenerateprojectfiles) | `GenerateProjectFiles(strSubdirectory = "")`; writes `modules.rst` plus one dotted-name `.rst` file per sorted native module and returns the names. The subdirectory must be a relative string without parent-directory components, colons, or NUL characters; invalid values are rejected before filesystem operations. |
| [`BuildProject`](#sphinxprojectbuildproject) | `BuildProject(bClean = false)`; writes `<project>/build/index.html` and returns its path. `bClean = true` currently only ensures the build directory exists; it does not remove previous output. |
| [`RunQuickStart`](#sphinxprojectrunquickstart) | `RunQuickStart(strAuthor, strProjectName = null, strVersion = "1")`; creates the project if absent, generates module files, builds the HTML index, and returns its path. |
| `ValidatePackage` / `ValidateProject` | Throw `SphinxError` when the corresponding path does not exist; otherwise return `true`. These checks do not verify directory type. |
| [`ValidateProjectAndPackage`](#sphinxprojectvalidateprojectandpackage) | Runs both validations and returns `true`. |
| [`GetConfigurationText`](#sphinxprojectgetconfigurationtext) | `GetConfigurationText(strAuthor, strProjectName, strVersion)`; returns `conf.py` text with `sphinx.ext.autodoc`. |
| [`GetIndexText`](#sphinxprojectgetindextext) | `GetIndexText(strProjectName)`; returns the root reStructuredText toctree. |
| [`GetModulesIndexText`](#sphinxprojectgetmodulesindextext) | `GetModulesIndexText(vecModuleNames)`; returns the module toctree. |
| [`GetModuleText`](#sphinxprojectgetmoduletext) | `GetModuleText(strModuleName)`; returns one `js:module` page with a runtime import example bound as `g_SourceModule`. |
| [`GetHTMLIndexText`](#sphinxprojectgethtmlindextext) | `GetHTMLIndexText(vecModuleNames)`; returns an HTML-escaped module list. |

## Examples

### `SphinxError`

```js
const { SphinxError } = require("autodoc");

try {
	throw new SphinxError("Unable to write the module reference.");
} catch (OperationError) {
	console.error(OperationError.name, OperationError.message);
}
```

### `SphinxProject`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");

console.log(g_Project.ProjectSourceDirectory, g_Project.ProjectBuildDirectory);
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("autodoc");

console.log(`Native module used for discovery: ${MODULE_NAME}`);
```

### `GetModuleNames`

```js
const { GetModuleNames } = require("autodoc");

for (const strModuleName of GetModuleNames()) {
	console.log(strModuleName);
}
```

### `SphinxProject.BuildProject`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesProjectExist()) {
	g_Project.CreateProject("Ren", "SourceJS API", "0.3.0");
}

g_Project.GenerateProjectFiles();

console.log(g_Project.BuildProject());
```

### `SphinxProject.GetConfigurationText`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strConfiguration = g_Project.GetConfigurationText("Ren", "SourceJS API", "0.3.0");
console.log(g_strConfiguration);
```

### `SphinxProject.CreateProject`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesProjectExist()) {
	g_Project.CreateProject("Ren", "SourceJS API", "0.3.0");
}
```

### `SphinxProject.GenerateProjectFiles`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesProjectExist()) {
	g_Project.CreateProject("Ren", "SourceJS API", "0.3.0");
}

const g_vecModuleNames = g_Project.GenerateProjectFiles();
console.log(`${g_vecModuleNames.length} module pages written.`);
```

### `SphinxProject.GetHTMLIndexText`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strHTML = g_Project.GetHTMLIndexText(["core", "players/entity", "memory/hooks"]);
console.log(g_strHTML);
```

### `SphinxProject.GetIndexText`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strIndex = g_Project.GetIndexText("SourceJS API");
console.log(g_strIndex);
```

### `SphinxProject.GetModuleText`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strModulePage = g_Project.GetModuleText("players/entity");
console.log(g_strModulePage);
```

### `SphinxProject.GetModulesIndexText`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strModulesIndex = g_Project.GetModulesIndexText(["core", "players/entity", "memory/hooks"]);
console.log(g_strModulesIndex);
```

### `SphinxProject.DoesPackageExist`

```js
const { SphinxProject } = require("autodoc");

const g_strPackageDirectory = "addons/sourcejs/packages/sourcejs";
const g_Project = new SphinxProject(g_strPackageDirectory, "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesPackageExist()) {
	throw new Error(`Package directory is missing: ${g_strPackageDirectory}`);
}
```

### `SphinxProject.DoesProjectExist`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
console.log(g_Project.DoesProjectExist() ? "Documentation project exists." : "Documentation project has not been created.");
```

### `SphinxProject.RunQuickStart`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
const g_strHTMLIndexPath = g_Project.RunQuickStart("Ren", "SourceJS API", "0.3.0");
console.log(g_strHTMLIndexPath);
```

### `SphinxProject.ValidatePackage`

```js
const { SphinxProject } = require("autodoc");

const g_strPackageDirectory = "addons/sourcejs/packages/sourcejs";
const g_Project = new SphinxProject(g_strPackageDirectory, "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
g_Project.ValidatePackage();

console.log(`Package exists: ${g_strPackageDirectory}`);
```

### `SphinxProject.ValidateProject`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesProjectExist()) {
	g_Project.CreateProject("Ren", "SourceJS API", "0.3.0");
}

g_Project.ValidateProject();
```

### `SphinxProject.ValidateProjectAndPackage`

```js
const { SphinxProject } = require("autodoc");

const g_Project = new SphinxProject("addons/sourcejs/packages/sourcejs", "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api");
if (!g_Project.DoesProjectExist()) {
	g_Project.CreateProject("Ren", "SourceJS API", "0.3.0");
}

g_Project.ValidateProjectAndPackage();

console.log("Package and project are ready.");
```

## Safe use and common mistakes

- Filesystem checks, writes, and text generation are synchronous on the calling JavaScript thread. These methods do not schedule worker requests or run an external documentation builder; generate large trees during a deliberate maintenance/startup phase.
- Keep `strProjectDirectory` inside a dedicated generated-data location such as `addons/sourcejs/data/sourcejs/autodoc`. Together, `CreateProject`, `GenerateProjectFiles`, and `BuildProject` write `conf.py`, `index.rst`, `modules.rst`, per-module pages, and `build/index.html`. Constructor-path normalization changes separators but does not reject `..` segments or establish containment. Supply trusted constructor paths; do not treat the project directory as a filesystem sandbox.
- `GenerateProjectFiles` requires a relative subdirectory string and rejects parent-directory components, absolute/drive paths, colons, and NUL before filesystem operations. This lexical check does not resolve symlinks or prevent traversal through an existing filesystem link; use a trusted output tree.
- The constructor checks whether `strPackageDirectory` exists immediately, but does not verify directory type. A missing package throws `SphinxError` before `DoesPackageExist` can be queried on the constructed instance.
- `CreateProject` throws when the project path already exists. Check `DoesProjectExist` first or use `RunQuickStart`, which creates only when necessary.
- `GenerateProjectFiles` overwrites its generated module index and current module pages but does not remove stale pages for modules no longer returned by `GetModuleNames`. Do not point it at hand-maintained documentation or a directory containing user-owned files with the same names.
- Generated `conf.py`, RST pages, and HTML indexes include format-appropriate comments identifying SourceJS autodoc as their generator. Treat these files as generated-only: change the generator or its inputs rather than editing output that regeneration overwrites. HTML keeps its doctype before the provenance comment.
- Root `index.rst` always references `modules`. Use the default empty `strSubdirectory` for a standalone generated project. A non-empty value writes the module toctree below that directory without updating the root reference; integrating that output requires a separate, hand-maintained entry point that references the nested toctree. Do not patch the generated root index manually.
- `BuildProject` writes the lightweight SourceJS HTML module index; it does not invoke an external Sphinx executable. `bClean = true` does not delete prior output. `RunQuickStart` performs the built-in create, generate, and HTML-index write sequence.
- `GetModuleNames` reflects the selected SDK. Check for a module or export before generating usage that depends on an optional native operation.
- Native module-name enumeration considers own string keys whose values are objects but not functions; the package
  copies and sorts the completed list. Native V8 failures/termination and C++ exceptions stop enumeration rather than
  being reported as an empty/partial list. Ordinary missing runtime/context/root-object fallbacks remain empty lists.
  The native result array is built with own data properties; reading module values can still invoke their existing getters.

## Related files

- [`packages/sourcejs/autodoc.js`](../../packages/sourcejs/autodoc.js) implements project validation, text generation, and file writes.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native module-name discovery operation.
- [`tools/smoke_autodoc.js`](../../tools/smoke_autodoc.js) verifies generation, escaping, path handling, and error behavior with a virtual filesystem.
- [`docs/api/README.md`](README.md) is the hand-maintained API index that generated projects must not overwrite.
