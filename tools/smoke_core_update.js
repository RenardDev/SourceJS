"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_unExpectedDefaultTimeoutMilliseconds = 3_000;
const g_unCustomTimeoutMilliseconds = 5_000;
const g_unHTTPOKStatusCode = 200;
const g_unHTTPServiceUnavailableStatusCode = 503;

const g_vecRequests = [];
const g_vecSubmittedOptions = [];
const g_vecInformation = [];
const g_vecWarnings = [];
let g_NativeBuild = { Architecture: "x64", GitCommit: "012345", Platform: "linux", SDKBranch: "csgo", Version: "1.0.0" };
let g_RequestError = null;
let g_Response = null;

function CompleteRequest(Request) {
	Request.Callback(Request.Error, Request.Response);
}

function RejectUnexpectedCallback() {
	throw new Error("Invalid update request arguments must be rejected before invoking a callback.");
}

function RequireDependency(strModuleName) {
	g_Assert.equal(strModuleName, "internal/runtime");

	return {
		GetModule(strNativeName) {
			if (strNativeName === "core/update") {
				return { GetCurrentBuild: () => g_NativeBuild };
			}

			if (strNativeName === "loggers") {
				return {
					LogInfo(strMessage) {
						g_vecInformation.push(strMessage);
					},
					LogWarning(strMessage) {
						g_vecWarnings.push(strMessage);
					},
				};
			}

			g_Assert.equal(strNativeName, "cpr");

			return {
				Get(Options, Callback) {
					g_vecSubmittedOptions.push(Options);
					const Request = { Callback, Error: g_RequestError, Response: g_Response };
					if (Options.Blocking === true) {
						CompleteRequest(Request);
					} else {
						g_vecRequests.push(Request);
					}

					return true;
				},
			};
		},
	};
}

const g_strSourcePath = g_Path.join(__dirname, "../packages/sourcejs/core/update.js");
const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strSourcePath, "utf8"), { module: g_Module, require: RequireDependency }, { filename: g_strSourcePath });

const g_Update = g_Module.exports;
g_Assert.equal(g_Update.DEFAULT_TIMEOUT, g_unExpectedDefaultTimeoutMilliseconds);
g_Assert.equal(g_Update.IsUpdateInProgress(), false);
g_Assert.equal(g_Update.SetUpdateInProgress(true), true);
g_Assert.equal(g_Update.SetUpdateInProgress(false), false);
g_Assert.throws(() => g_Update.SetUpdateInProgress(1), { name: "TypeError" });
g_Assert.notEqual(g_Update.GetCurrentBuild(), g_NativeBuild);
g_Assert.equal(g_Update.GetCurrentBuild().GitCommit, g_NativeBuild.GitCommit);

g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: '{"Value":42}' };
let g_unCallbackCount = 0;
let g_Result = null;
g_Assert.equal(g_Update.FetchJSON("https://example.invalid/data", {}, (RequestError, Result) => {
	g_Assert.equal(RequestError, null);
	g_unCallbackCount += 1;
	g_Result = Result;
}), undefined);
g_Assert.equal(g_unCallbackCount, 0);
g_Assert.equal(g_vecSubmittedOptions.at(-1).Timeout, g_unExpectedDefaultTimeoutMilliseconds);
g_Assert.equal(g_vecSubmittedOptions.at(-1).Headers.Accept, "application/json");
g_Assert.equal(g_vecSubmittedOptions.at(-1).Headers["User-Agent"], "SourceJS");
CompleteRequest(g_vecRequests.shift());
g_Assert.equal(g_unCallbackCount, 1);
g_Assert.equal(g_Result.Value, 42);

for (const InvalidAsset of [null, 1, "asset", [], {}]) {
	g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: JSON.stringify({ assets: [{ browser_download_url: "https://example.invalid/valid.zip" }, InvalidAsset] }) };
	let unCallbackCount = 0;
	let ResultError = null;
	g_Update.GetBuildArtifactURLs({}, (RequestError) => {
		unCallbackCount += 1;
		ResultError = RequestError;
	});
	g_Assert.doesNotThrow(() => CompleteRequest(g_vecRequests.shift()));
	g_Assert.equal(unCallbackCount, 1);
	g_Assert.equal(ResultError.name, "TypeError");
}

const g_strDownloadURL = "https://example.invalid/SourceJS-Linux-CSGO-X64.tar.gz?token=test#download";
g_Response = {
	StatusCode: g_unHTTPOKStatusCode,
	Error: "",
	OK: true,
	Text: JSON.stringify({ tag_name: "1.0.0", assets: [
		{ browser_download_url: "https://example.invalid/sourcejs-linux-csgo-x64-other.zip" },
		{ browser_download_url: g_strDownloadURL },
	] }),
};

for (const bBlocking of [false, true]) {
	let unCallbackCount = 0;
	let strResultURL = null;
	g_Update.GetBuildDownloadURL({ Blocking: bBlocking, Timeout: g_unCustomTimeoutMilliseconds, Platform: "LINUX", Architecture: "amd64" }, (RequestError, strURL) => {
		g_Assert.equal(RequestError, null);
		unCallbackCount += 1;
		strResultURL = strURL;
	});
	g_Assert.equal(unCallbackCount, bBlocking ? 1 : 0);

	if (!bBlocking) {
		CompleteRequest(g_vecRequests.shift());
	}

	g_Assert.equal(unCallbackCount, 1);
	g_Assert.equal(strResultURL, g_strDownloadURL);
	g_Assert.equal(g_vecSubmittedOptions.at(-1).Blocking, bBlocking);
	g_Assert.equal(g_vecSubmittedOptions.at(-1).Timeout, g_unCustomTimeoutMilliseconds);
	g_Assert.equal(g_vecSubmittedOptions.at(-1).URL, g_Update.LATEST_RELEASE_URL);
}

const g_TransportError = new Error("Controlled transport failure");
g_RequestError = g_TransportError;
g_Update.GetLatestRelease({ Blocking: true }, (RequestError) => g_Assert.equal(RequestError, g_TransportError));
g_RequestError = null;

for (const Response of [
	{ StatusCode: g_unHTTPServiceUnavailableStatusCode, Error: "", OK: false, Text: "{}" },
	{ StatusCode: g_unHTTPOKStatusCode, Error: "Controlled HTTP library failure", OK: true, Text: "{}" },
	{ StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: "invalid JSON" },
]) {
	g_Response = Response;
	let unCallbackCount = 0;
	g_Update.GetLatestRelease({ Blocking: true }, (RequestError) => {
		g_Assert.ok(RequestError);
		unCallbackCount += 1;
	});
	g_Assert.equal(unCallbackCount, 1);
}

g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: '{"tag_name":"1.0.0"}' };
g_Update.IsNewVersionAvailable({ Blocking: true }, (RequestError, bAvailable) => {
	g_Assert.equal(RequestError, null);
	g_Assert.equal(bAvailable, false);
});
g_NativeBuild = null;
g_Update.IsNewVersionAvailable({ Blocking: true }, (RequestError) => g_Assert.equal(RequestError.name, "TypeError"));

g_NativeBuild = { Architecture: "x86", GitCommit: "012345", Platform: "windows", SDKBranch: "l4d2", Version: "0.3.0" };
for (const [strTagName, bExpected] of [
	["v0.3.0", false],
	["0.3.0+release.42", false],
	["0.2.99", false],
	["v0.3.10", true],
	["0.10.0", true],
	["9007199254740993.0.0", true],
]) {
	g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: JSON.stringify({ tag_name: strTagName }) };
	g_Update.IsNewVersionAvailable({ Blocking: true }, (RequestError, bAvailable) => {
		g_Assert.equal(RequestError, null);
		g_Assert.equal(bAvailable, bExpected, strTagName);
	});
}

for (const strTagName of ["0.03.1", "0.3.1-rc.1", "0.3.1\n", "release/latest"]) {
	g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: JSON.stringify({ tag_name: strTagName }) };
	g_Update.IsNewVersionAvailable({ Blocking: true }, (RequestError, bAvailable) => {
		g_Assert.match(RequestError.message, /stable version/);
		g_Assert.equal(bAvailable, undefined);
	});
}

const g_strApplicationSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "../src/sourcejs/Application.cpp"), "utf8");
const g_nLoadStart = g_strApplicationSource.indexOf("bool Application::Load(");
const g_nLoadEnd = g_strApplicationSource.indexOf("void Application::Unload(", g_nLoadStart);
g_Assert.ok((g_nLoadStart >= 0) && (g_nLoadEnd > g_nLoadStart));
const g_strLoadSource = g_strApplicationSource.slice(g_nLoadStart, g_nLoadEnd);
const g_vecStartupChecks = [...g_strLoadSource.matchAll(/m_Runtime\.ExecuteString\(("(?:[^"\\]|\\.)*"), "SourceJS startup update check"\);/g)];
g_Assert.equal(g_vecStartupChecks.length, 1);
g_Assert.ok(g_strLoadSource.indexOf("m_bLoaded = true;") < g_vecStartupChecks[0].index);

const g_strStartupScript = JSON.parse(g_vecStartupChecks[0][1]);
g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: '{"tag_name":"v0.3.1","assets":[{"browser_download_url":"https://example.invalid/sourcejs.zip"}]}' };
const g_unRequestsBeforeStartup = g_vecSubmittedOptions.length;
g_VM.runInNewContext(g_strStartupScript, {
	require(strModuleName) {
		g_Assert.equal(strModuleName, "core/update");
		return g_Update;
	},
});
g_Assert.equal(g_vecRequests.length, 1);
g_Assert.equal(g_vecInformation.length, 0, "Startup does not wait for network IO.");
g_Assert.equal(g_vecSubmittedOptions.at(-1).Blocking, false);
g_Assert.equal(g_vecSubmittedOptions.at(-1).URL, g_Update.LATEST_RELEASE_URL);
CompleteRequest(g_vecRequests.shift());
g_Assert.equal(g_vecSubmittedOptions.length, g_unRequestsBeforeStartup + 1, "No archive request is submitted.");
g_Assert.match(g_vecInformation.join("\n"), /SourceJS update available: 0\.3\.0 -> v0\.3\.1/);
g_Assert.ok(g_vecInformation.includes("Build target: l4d2/windows/x86"));
g_Assert.ok(g_vecInformation.includes("Release: https://github.com/RenardDev/SourceJS/releases/tag/v0.3.1"));
g_Assert.match(g_vecInformation.join("\n"), /Install manually with the server stopped/);
g_Assert.equal(g_vecWarnings.length, 0);

const g_unBannerLineCount = g_vecInformation.length;
g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: '{"tag_name":"v0.3.0"}' };
g_Update.AnnounceAvailableUpdate();
CompleteRequest(g_vecRequests.shift());
g_Assert.equal(g_vecInformation.length, g_unBannerLineCount);
g_Assert.equal(g_vecWarnings.length, 0);

g_Response = { StatusCode: 404, Error: "", OK: false, Text: "{}" };
g_Update.AnnounceAvailableUpdate();
CompleteRequest(g_vecRequests.shift());
g_Assert.equal(g_vecInformation.length, g_unBannerLineCount);
g_Assert.equal(g_vecWarnings.length, 1);

g_Response = { StatusCode: g_unHTTPOKStatusCode, Error: "", OK: true, Text: "{}" };
const g_CallbackError = new Error("Controlled callback failure");
g_Assert.throws(() => g_Update.GetLatestRelease({ Blocking: true }, () => {
	throw g_CallbackError;
}), (ErrorValue) => ErrorValue === g_CallbackError);
g_Assert.throws(() => g_Update.FetchJSON("", {}, RejectUnexpectedCallback), { name: "TypeError" });
g_Assert.throws(() => g_Update.GetLatestRelease(null, RejectUnexpectedCallback), { name: "TypeError" });
g_Assert.throws(() => g_Update.GetBuildArtifactURLs({}, null), { name: "TypeError" });
g_Assert.throws(() => g_Update.GetLatestRelease({ Timeout: 0 }, RejectUnexpectedCallback), { name: "TypeError" });
g_Assert.equal(g_vecRequests.length, 0);

console.log("Core update smoke checks passed (actual JS helper; queued/Blocking CPR and native-build doubles, no network IO).");
