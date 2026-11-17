"use strict";

const { GetModule } = require("internal/runtime");

const g_unDefaultTimeout = 3000;
const g_strLatestReleaseURL = "https://api.github.com/repos/RenardDev/SourceJS/releases/latest";
const g_strReleasePageBaseURL = "https://github.com/RenardDev/SourceJS/releases/tag/";

const g_UpdateRuntime = GetModule("core/update");
const g_CPRRuntime = GetModule("cpr");

let g_bUpdateInProgress = false;

function RequireNonEmptyString(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

function RequireTimeout(unTimeout) {
	if (!Number.isSafeInteger(unTimeout) || (unTimeout <= 0)) {
		throw new TypeError("Update timeout must be a positive safe integer.");
	}

	return unTimeout;
}

function NormalizePlatform(strPlatform) {
	const strNormalizedPlatform = RequireNonEmptyString(strPlatform, "Update platform").toLowerCase();
	if ((strNormalizedPlatform === "win") || (strNormalizedPlatform === "win32") || (strNormalizedPlatform === "windows")) {
		return "windows";
	}

	if (strNormalizedPlatform === "linux") {
		return "linux";
	}

	throw new Error(`Unsupported SourceJS platform: ${strPlatform}`);
}

function NormalizeArchitecture(strArchitecture) {
	const strNormalizedArchitecture = RequireNonEmptyString(strArchitecture, "Update architecture").toLowerCase();
	if ((strNormalizedArchitecture === "x64") || (strNormalizedArchitecture === "amd64") || (strNormalizedArchitecture === "x86_64")) {
		return "x64";
	}

	if ((strNormalizedArchitecture === "x86") || (strNormalizedArchitecture === "ia32") || (strNormalizedArchitecture === "i386")) {
		return "x86";
	}

	throw new Error(`Unsupported SourceJS architecture: ${strArchitecture}`);
}

function IsUpdateInProgress() {
	return g_bUpdateInProgress;
}

function SetUpdateInProgress(bUpdateInProgress) {
	if (typeof bUpdateInProgress !== "boolean") {
		throw new TypeError("Update state must be a boolean.");
	}

	g_bUpdateInProgress = bUpdateInProgress;

	return g_bUpdateInProgress;
}

function FetchJSON(strRequestURL, Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Update request options must be an object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Update request callback must be a function.");
	}

	const strValidatedRequestURL = RequireNonEmptyString(strRequestURL, "Update URL");
	const unRequestTimeout = RequireTimeout(Options.Timeout ?? g_unDefaultTimeout);
	const HTTPRequestOptions = {
		Headers: {
			Accept: "application/json",
			"User-Agent": "SourceJS",
		},
		Timeout: unRequestTimeout,
		URL: strValidatedRequestURL,
	};
	if (Object.hasOwn(Options, "Blocking")) {
		HTTPRequestOptions.Blocking = Options.Blocking;
	}

	g_CPRRuntime.Get(HTTPRequestOptions, (RequestError, HTTPResponse) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		const unHTTPStatusCode = HTTPResponse.StatusCode;
		const strResponseError = HTTPResponse.Error;
		if (strResponseError.length > 0) {
			Callback(new Error(strResponseError));
			return;
		}

		if (!HTTPResponse.OK) {
			Callback(new Error(`HTTP ${unHTTPStatusCode} while fetching ${strValidatedRequestURL}`));
			return;
		}

		let ParsedResponse;
		try {
			ParsedResponse = JSON.parse(HTTPResponse.Text);
		} catch (ErrorValue) {
			Callback(ErrorValue);
			return;
		}

		Callback(null, ParsedResponse);
	});
}

function GetLatestRelease(Options, Callback) {
	return FetchJSON(g_strLatestReleaseURL, Options, Callback);
}

function GetBuildArtifactURLs(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Update artifact options must be an object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Update request callback must be a function.");
	}

	GetLatestRelease(Options, (RequestError, GitHubRelease) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		if (!GitHubRelease || (typeof GitHubRelease !== "object") || Array.isArray(GitHubRelease)) {
			Callback(new TypeError("GitHub release response must be an object."));
			return;
		}

		const vecReleaseAssets = GitHubRelease.assets;
		if (!Array.isArray(vecReleaseAssets)) {
			Callback(new TypeError("GitHub release assets must be an array."));
			return;
		}

		const vecArtifactURLs = [];
		for (const ReleaseAsset of vecReleaseAssets) {
			if (!ReleaseAsset || (typeof ReleaseAsset !== "object") || Array.isArray(ReleaseAsset)) {
				Callback(new TypeError("GitHub release asset must be an object."));
				return;
			}

			const strDownloadURL = ReleaseAsset.browser_download_url;
			if ((typeof strDownloadURL !== "string") || (strDownloadURL.length === 0)) {
				Callback(new TypeError("GitHub release asset download URL must be a non-empty string."));
				return;
			}

			vecArtifactURLs.push(strDownloadURL);
		}

		Callback(null, vecArtifactURLs);
	});
}

function GetCurrentBuild() {
	const NativeBuild = g_UpdateRuntime.GetCurrentBuild();
	if (!NativeBuild || (typeof NativeBuild !== "object") || Array.isArray(NativeBuild)) {
		throw new TypeError("Native core/update GetCurrentBuild() must return a build object.");
	}

	return {
		Architecture: RequireNonEmptyString(NativeBuild.Architecture, "Current build architecture"),
		GitCommit: RequireNonEmptyString(NativeBuild.GitCommit, "Current build Git commit"),
		Platform: RequireNonEmptyString(NativeBuild.Platform, "Current build platform"),
		SDKBranch: RequireNonEmptyString(NativeBuild.SDKBranch, "Current build SDK branch"),
		Version: RequireNonEmptyString(NativeBuild.Version, "Current build version"),
	};
}

function GetBuildDownloadURL(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Update download options must be an object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Update request callback must be a function.");
	}

	const CurrentBuild = GetCurrentBuild();
	const strSDKBranch = RequireNonEmptyString(Options.SDKBranch ?? CurrentBuild.SDKBranch, "Update SDK branch");
	const strNormalizedSDKBranch = strSDKBranch.toLowerCase();
	const strPlatformToken = NormalizePlatform(Options.Platform ?? CurrentBuild.Platform);
	const strArchitectureToken = NormalizeArchitecture(Options.Architecture ?? CurrentBuild.Architecture);
	const unRequestTimeout = RequireTimeout(Options.Timeout ?? g_unDefaultTimeout);
	const strExpectedArtifactName = `sourcejs-${strPlatformToken}-${strNormalizedSDKBranch}-${strArchitectureToken}`;
	const ArtifactRequestOptions = { Timeout: unRequestTimeout };
	if (Object.hasOwn(Options, "Blocking")) {
		ArtifactRequestOptions.Blocking = Options.Blocking;
	}

	GetBuildArtifactURLs(ArtifactRequestOptions, (RequestError, vecArtifactURLs) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		let strDownloadURL = null;
		for (const strArtifactURL of vecArtifactURLs) {
			const strNormalizedArtifactURL = strArtifactURL.toLowerCase();
			const nQuerySeparatorIndex = strNormalizedArtifactURL.indexOf("?");
			const nFragmentSeparatorIndex = strNormalizedArtifactURL.indexOf("#");
			let unArtifactPathEndIndex = strNormalizedArtifactURL.length;
			if ((nQuerySeparatorIndex >= 0) && (nQuerySeparatorIndex < unArtifactPathEndIndex)) {
				unArtifactPathEndIndex = nQuerySeparatorIndex;
			}

			if ((nFragmentSeparatorIndex >= 0) && (nFragmentSeparatorIndex < unArtifactPathEndIndex)) {
				unArtifactPathEndIndex = nFragmentSeparatorIndex;
			}

			const strArtifactPath = strNormalizedArtifactURL.slice(0, unArtifactPathEndIndex);
			const nPathSeparatorIndex = Math.max(strArtifactPath.lastIndexOf("/"), strArtifactPath.lastIndexOf("\\"));
			const strArtifactFileName = strArtifactPath.slice(nPathSeparatorIndex + 1);
			if ((strArtifactFileName === strExpectedArtifactName) || strArtifactFileName.startsWith(`${strExpectedArtifactName}.`)) {
				strDownloadURL = strArtifactURL;
				break;
			}
		}

		if (strDownloadURL === null) {
			Callback(new Error(`Unable to find SourceJS artifact for ${strSDKBranch}/${strPlatformToken}/${strArchitectureToken}.`));
			return;
		}

		Callback(null, strDownloadURL);
	});
}

function ReadStableVersion(strVersion) {
	if (typeof strVersion !== "string") {
		return null;
	}

	const vecMatch = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(strVersion);

	return (vecMatch && (vecMatch[0] === strVersion)) ? vecMatch.slice(1, 4) : null;
}

function IsStableVersionNewer(vecReleaseVersion, vecCurrentVersion) {
	for (let unIndex = 0; unIndex < vecReleaseVersion.length; unIndex += 1) {
		const strReleasePart = vecReleaseVersion[unIndex];
		const strCurrentPart = vecCurrentVersion[unIndex];
		if (strReleasePart.length !== strCurrentPart.length) {
			return strReleasePart.length > strCurrentPart.length;
		}

		if (strReleasePart !== strCurrentPart) {
			return strReleasePart > strCurrentPart;
		}
	}

	return false;
}

function FindAvailableUpdate(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Update version-check options must be an object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Update request callback must be a function.");
	}

	GetLatestRelease(Options, (RequestError, GitHubRelease) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		if (!GitHubRelease || (typeof GitHubRelease !== "object") || Array.isArray(GitHubRelease)) {
			Callback(new TypeError("GitHub release response must be an object."));
			return;
		}

		const strReleaseTagName = GitHubRelease.tag_name;
		const vecReleaseVersion = ReadStableVersion(strReleaseTagName);
		if (!vecReleaseVersion) {
			Callback(new Error("GitHub release tag must be a stable version (MAJOR.MINOR.PATCH)."));
			return;
		}

		let CurrentBuild;
		try {
			CurrentBuild = GetCurrentBuild();
		} catch (ErrorValue) {
			Callback(ErrorValue);
			return;
		}

		const vecCurrentVersion = ReadStableVersion(CurrentBuild.Version);
		if (!vecCurrentVersion) {
			Callback(new Error("The running SourceJS build must have a stable version (MAJOR.MINOR.PATCH)."));
			return;
		}

		if (!IsStableVersionNewer(vecReleaseVersion, vecCurrentVersion)) {
			Callback(null, null);
			return;
		}

		Callback(null, {
			CurrentBuild,
			ReleaseVersion: strReleaseTagName,
			ReleaseURL: g_strReleasePageBaseURL + encodeURIComponent(strReleaseTagName),
		});
	});
}

function IsNewVersionAvailable(Options, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Update request callback must be a function.");
	}

	return FindAvailableUpdate(Options, (RequestError, AvailableUpdate) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		Callback(null, AvailableUpdate !== null);
	});
}

function AnnounceAvailableUpdate() {
	const { LogInfo, LogWarning } = GetModule("loggers");
	FindAvailableUpdate({ Blocking: false }, (RequestError, AvailableUpdate) => {
		if (RequestError) {
			LogWarning("SourceJS update check could not read a comparable published release.");
			return;
		}

		if (!AvailableUpdate) {
			return;
		}

		const { CurrentBuild } = AvailableUpdate;
		LogInfo("================================================================");
		LogInfo(`SourceJS update available: ${CurrentBuild.Version} -> ${AvailableUpdate.ReleaseVersion}`);
		LogInfo(`Build target: ${CurrentBuild.SDKBranch}/${CurrentBuild.Platform}/${CurrentBuild.Architecture}`);
		LogInfo(`Release: ${AvailableUpdate.ReleaseURL}`);
		LogInfo("Install manually with the server stopped. No SourceJS package was downloaded or installed.");
		LogInfo("================================================================");
	});
}

module.exports = {
	DEFAULT_TIMEOUT: g_unDefaultTimeout,
	LATEST_RELEASE_URL: g_strLatestReleaseURL,
	AnnounceAvailableUpdate,
	FetchJSON,
	GetBuildArtifactURLs,
	GetBuildDownloadURL,
	GetCurrentBuild,
	GetLatestRelease,
	IsNewVersionAvailable,
	IsUpdateInProgress,
	SetUpdateInProgress,
};
