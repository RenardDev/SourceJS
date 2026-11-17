
// C++
#include <cerrno>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <utility>

// STL
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

// Third-party
#include <libplatform/libplatform.h>
#include <v8.h>

namespace SourceJS {

	namespace {

		// Controlled SDK-shaped storage, not a game-server or SDK ABI model.
		struct edict_t {
			bool IsFree() const {
				if (m_bRetired) {
					throw std::runtime_error("Touched a retired edict");
				}

				return m_bFree;
			}

			bool m_bFree;
			bool m_bRetired;
			int m_nUserID;
		};

		struct FixtureEngine {
			int GetPlayerUserId(edict_t const* const pEdict) const {
				if (pEdict->m_bRetired) {
					throw std::runtime_error("Read identity from a retired edict");
				}

				return pEdict->m_nUserID;
			}
		};

		using fnDisposeIsolate = void(*)(v8::Isolate*);

		constexpr int kPlayerIndex = 4;
		constexpr int kInitialUserID = 42;
		constexpr int kFixtureInvalidUserID = -1;
		constexpr int kFreeEdictMutation = 0;
		constexpr int kNegativeUserIDMutation = 1;
		constexpr int kChangedUserIDMutation = 2;
		constexpr int kReplacedEdictMutation = 3;
		constexpr int kDetachedEdictMutation = 4;
		constexpr int kZeroUserIDMutation = 5;
		constexpr std::uint32_t kUncommittedUInt32Value = 73;
		constexpr char kUInt32ErrorMessage[] = "Invalid Steam UInt32 value";

		constinit edict_t g_InitialEdict {};
		constinit edict_t g_ReplacementEdict {};
		constinit edict_t* g_pCurrentEdict = nullptr;
		constinit FixtureEngine g_Engine {};
		constinit bool g_bNativeInvariantFailed = false;

		void Require(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				throw std::runtime_error(pszMessage);
			}
		}

@BASIC_HELPERS@

		edict_t* GetEdictFromEntityIndex(const int nPlayerIndex) {
			return (nPlayerIndex == kPlayerIndex) ? g_pCurrentEdict : nullptr;
		}

		FixtureEngine* RequireEngineServer(v8::Isolate*, char const*) {
			return &g_Engine;
		}

@ACTUAL_PLAYER_EDICT_HELPER@

@RECIPIENT_HELPERS@

@STEAM_UINT32_HELPER@

		void ResetFixtureCallback(v8::FunctionCallbackInfo<v8::Value> const&) {
			g_InitialEdict = { false, false, kInitialUserID };
			g_ReplacementEdict = { false, false, kInitialUserID };
			g_pCurrentEdict = &g_InitialEdict;
		}

		void MutateRecipientCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			const int nMode = Information[0].As<v8::Int32>()->Value();
			switch (nMode) {
				case kFreeEdictMutation:
					g_pCurrentEdict->m_bFree = true;
					break;

				case kNegativeUserIDMutation:
					g_pCurrentEdict->m_nUserID = kFixtureInvalidUserID;
					break;

				case kChangedUserIDMutation:
					++g_pCurrentEdict->m_nUserID;
					break;

				case kReplacedEdictMutation:
					g_InitialEdict.m_bRetired = true;
					g_pCurrentEdict = &g_ReplacementEdict;
					break;

				case kDetachedEdictMutation:
					g_pCurrentEdict = nullptr;
					break;

				case kZeroUserIDMutation:
					g_pCurrentEdict->m_nUserID = 0;
					break;

				default:
					g_bNativeInvariantFailed = true;
					ThrowError(Information.GetIsolate(), "Unknown controlled recipient mutation");
					return;
			}
		}

		void RecipientCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			auto* const pIsolate = Information.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			try {
				MessagesRecipientIdentity Identity {};
				if (!CaptureMessagesRecipientIdentity(pIsolate, LocalContext, Information[0], "Recipient()", Identity)) {
					return;
				}

				v8::Local<v8::Value> LocalIgnored {};
				if (!Information[1].As<v8::Function>()->Call(LocalContext, v8::Undefined(pIsolate), 0, nullptr).ToLocal(&LocalIgnored)) {
					return;
				}

				auto* const pRecipient = RequireMessagesRecipientEdict(pIsolate, Identity, "Recipient()");
				if (!pRecipient) {
					return;
				}

				Require(pRecipient == g_pCurrentEdict, "Use the fresh edict");
				Information.GetReturnValue().Set(true);
			} catch (std::exception const& Failure) {
				ThrowError(pIsolate, Failure.what());
			}
		}

		void UInt32Callback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			auto* const pIsolate = Information.GetIsolate();
			std::uint32_t unResult = kUncommittedUInt32Value;
			const bool bParsed = GetSteamUInt32FromValue(pIsolate, pIsolate->GetCurrentContext(), Information[0], kUInt32ErrorMessage, unResult);
			if (!bParsed) {
				if (unResult != kUncommittedUInt32Value) {
					g_bNativeInvariantFailed = true;
				}

				return;
			}

			Information.GetReturnValue().Set(unResult);
		}

		// Controlled SDK adapters for dialog/menu and SteamID callback regression tests.
		// No native SDK layout, allocator, game-server or delivery claim.
		struct CSteamID {
			std::uint32_t GetAccountID() const noexcept {
				return m_unAccountID;
			}

			std::uint32_t GetUnAccountInstance() const noexcept {
				return m_unAccountInstance;
			}

			int GetEAccountType() const noexcept {
				return m_nAccountType;
			}

			int GetEUniverse() const noexcept {
				return m_nUniverse;
			}

			std::uint64_t GetStaticAccountKey() const noexcept {
				return m_unStaticAccountKey;
			}

			std::uint64_t ConvertToUint64() const noexcept {
				return m_unValue;
			}

			bool IsValid() const noexcept {
				return m_bValid;
			}

			std::uint32_t m_unAccountID;
			std::uint32_t m_unAccountInstance;
			int m_nAccountType;
			int m_nUniverse;
			std::uint64_t m_unStaticAccountKey;
			std::uint64_t m_unValue;
			bool m_bValid;
		};

		// Exact SDK vocabulary is retained; these values are a controlled test model.
		typedef enum _DIALOG_TYPE : int {
			DIALOG_MSG = 0,
			DIALOG_MENU,
			DIALOG_TEXT,
			DIALOG_ENTRY,
			DIALOG_ASKCONNECT
		} DIALOG_TYPE, *PDIALOG_TYPE;

		class KeyValues {
		public:
			explicit KeyValues(char const* pszName);
			~KeyValues();
			KeyValues(KeyValues const&) = delete;
			KeyValues& operator=(KeyValues const&) = delete;

			void SetString(char const*, char const*);
			void SetInt(char const*, int);
			KeyValues* FindKey(char const* pszName, bool bCreate);
			void deleteThis();

		private:
			std::vector<std::unique_ptr<KeyValues>> m_vecChildren;
		};

		constexpr CSteamID kInitialSteamID { 11, 2, 3, 4, 91, 117, true };
		constexpr CSteamID kMutatedSteamID { 111, 222, 333, 444, 555, 666, false };

		constinit CSteamID g_SteamID = kInitialSteamID;
		constinit bool g_bSteamConstructionMutation = false;
		constinit std::size_t g_unLiveKeyValues = 0;
		constinit std::size_t g_unDialogDispatches = 0;
		constinit bool g_bDispatchUsedCurrentEdict = false;
		constinit int g_nDialogUserID = kFixtureInvalidUserID;
		constinit bool g_bMutateKeyValuesRecipient = false;

		// Exact application-global spelling required by injected callbacks; only its address is observed.
		constinit int g_SourceJSPlugin = 0;

		// Controlled construction-entry mutation, not an allocator/OOM/GC simulation.
		v8::Local<v8::Object> CreateFixtureSteamFieldsObject(v8::Isolate* const pIsolate) {
			v8::Local<v8::Object> const LocalObject = v8::Object::New(pIsolate);
			if (!LocalObject.IsEmpty() && g_bSteamConstructionMutation) {
				g_bSteamConstructionMutation = false;
				g_SteamID = kMutatedSteamID;
			}

			return LocalObject;
		}

		void ApplyKeyValuesMutation() {
			if (g_bMutateKeyValuesRecipient) {
				++g_pCurrentEdict->m_nUserID;
				g_bMutateKeyValuesRecipient = false;
			}
		}

		KeyValues::KeyValues(char const*) {
			++g_unLiveKeyValues;
		}

		KeyValues::~KeyValues() {
			--g_unLiveKeyValues;
		}

		void KeyValues::SetString(char const*, char const*) {
			ApplyKeyValuesMutation();
		}

		void KeyValues::SetInt(char const*, int) {
			ApplyKeyValuesMutation();
		}

		KeyValues* KeyValues::FindKey(char const* const pszName, const bool bCreate) {
			if (!bCreate) {
				return nullptr;
			}

			std::unique_ptr<KeyValues> pChild(new KeyValues(pszName));
			auto* const pBorrowedChild = pChild.get();
			m_vecChildren.push_back(std::move(pChild));

			return pBorrowedChild;
		}

		void KeyValues::deleteThis() {
			delete this;
		}

		struct FixtureServerPluginHelpers {
			void CreateMessage(edict_t* const pEdict, DIALOG_TYPE, KeyValues*, void*) const {
				++g_unDialogDispatches;
				g_bDispatchUsedCurrentEdict = pEdict == g_pCurrentEdict;
				g_nDialogUserID = pEdict ? pEdict->m_nUserID : kFixtureInvalidUserID;
			}
		};

		constinit FixtureServerPluginHelpers g_PluginHelpers {};

		FixtureServerPluginHelpers* RequireServerPluginHelpers(v8::Isolate*, char const*) {
			return &g_PluginHelpers;
		}

		bool RequireKeyValuesSystem(v8::Isolate*, char const*) {
			return true;
		}

		void GetLastDialogTypeCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
#if defined(SOURCEJS_OLD_CONSOLE_API)
			constexpr int kLastDialogType = DIALOG_ENTRY;
#else
			constexpr int kLastDialogType = DIALOG_ASKCONNECT;
#endif

			Information.GetReturnValue().Set(kLastDialogType);
		}

@ACTUAL_FULL_CALLBACK_HELPERS@

		// Installation uses the real installer and V8 helpers, but controlled SDK
		// constants/storage and callback addresses; no Steam operation or ABI is tested.
		namespace FixtureSteamInstallation {

			struct CSteamID {
				std::uint64_t m_unValue;
			};

			constexpr int k_EUniverseInvalid = 0;
			constexpr int k_EUniversePublic = 1;
			constexpr int k_EUniverseBeta = 2;
			constexpr int k_EUniverseInternal = 3;
			constexpr int k_EUniverseDev = 4;
			constexpr int k_EUniverseMax = 5;
			constexpr int k_EAccountTypeInvalid = 0;
			constexpr int k_EAccountTypeIndividual = 1;
			constexpr int k_EAccountTypeMultiseat = 2;
			constexpr int k_EAccountTypeGameServer = 3;
			constexpr int k_EAccountTypeAnonGameServer = 4;
			constexpr int k_EAccountTypePending = 5;
			constexpr int k_EAccountTypeContentServer = 6;
			constexpr int k_EAccountTypeClan = 7;
			constexpr int k_EAccountTypeChat = 8;

			constinit int g_nHostData = 73;

			void FixtureCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				v8::Local<v8::Value> const LocalData = Information.Data();
				if (LocalData.IsEmpty() || !LocalData->IsExternal() || (LocalData.As<v8::External>()->Value() != &g_nHostData)) {
					ThrowError(pIsolate, "Steam installation lost callback data.");
					return;
				}

				Information.GetReturnValue().Set(g_nHostData);
			}

@ACTUAL_STEAM_INSTALLATION_HELPERS@

			void CreateModuleCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				try {
					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Object> const LocalModule = v8::Object::New(pIsolate);
					v8::Local<v8::External> const LocalData = v8::External::New(pIsolate, &g_nHostData);
					if (LocalModule.IsEmpty() || LocalData.IsEmpty() || !InstallSteamIDFunctions(pIsolate, LocalContext, LocalModule, LocalData)) {
						return;
					}

					Information.GetReturnValue().Set(LocalModule);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled Steam installation C++ failure.");
					}
				}
			}

			void GetProfileCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				constexpr int kL4D2Profile = 0x1;
				constexpr int kBMSProfile = 0x2;
#if defined(SOURCEJS_OLD_CONSOLE_API)
				constexpr int kLegacyProfile = 0x4;
#endif

				int nProfile = 0;
				if (IsSteamL4D2Branch()) {
					nProfile |= kL4D2Profile;
				}

				if (IsSteamBMSBranch()) {
					nProfile |= kBMSProfile;
				}

#if defined(SOURCEJS_OLD_CONSOLE_API)
				nProfile |= kLegacyProfile;
#endif

				Information.GetReturnValue().Set(nProfile);
			}

		} // namespace FixtureSteamInstallation

@ACTUAL_AUTHENTICATION_INSTALLATION_HELPERS@

		void CreateAuthenticationInstallationCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			constexpr int kSQLBackendArgumentIndex = 0;

			auto* const pIsolate = Information.GetIsolate();
			try {
				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				v8::Local<v8::Object> const LocalModule = MakeModule(pIsolate);
				v8::Local<v8::External> const LocalData = v8::External::New(pIsolate, &FixtureSteamInstallation::g_nHostData);
				if (LocalModule.IsEmpty() || LocalData.IsEmpty()) {
					return;
				}

				const bool bSQLBackend = (Information.Length() > kSQLBackendArgumentIndex) && Information[kSQLBackendArgumentIndex]->IsTrue();
				const bool bInstalled = bSQLBackend ? InstallAuthenticationSQLFunctions(pIsolate, LocalContext, LocalModule, LocalData) : InstallAuthenticationFunctions(pIsolate, LocalContext, LocalModule, LocalData);
				if (!bInstalled) {
					return;
				}

				Information.GetReturnValue().Set(LocalModule);
			} catch (...) {
				if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
					ThrowError(pIsolate, "Controlled authentication installation C++ failure.");
				}
			}
		}

		namespace FixtureWeaponInstallation {

@WEAPON_FEATURE_DEFINITIONS@

// Controlled values exercise forwarding and availability, not SDK numeric compatibility.
#if defined(SOURCEJS_HAS_WEAPON_SHAREDDEFS) && defined(SOURCEJS_HAS_WEAPON_PARSE) && defined(SOURCEJS_HAS_WEAPON_PROFICIENCY)
			constexpr int ITEM_FLAG_SELECTONEMPTY = 0x1;
			constexpr int ITEM_FLAG_NOAUTORELOAD = 0x2;
			constexpr int ITEM_FLAG_NOAUTOSWITCHEMPTY = 0x4;
			constexpr int ITEM_FLAG_LIMITINWORLD = 0x8;
			constexpr int ITEM_FLAG_EXHAUSTIBLE = 0x10;
			constexpr int ITEM_FLAG_DOHITLOCATIONDMG = 0x20;
			constexpr int ITEM_FLAG_NOAMMOPICKUPS = 0x40;
#ifdef SOURCEJS_HAS_ITEM_FLAG_NOITEMPICKUP
			constexpr int ITEM_FLAG_NOITEMPICKUP = 0x80;
#endif
			constexpr int WEAPON_NOT_CARRIED = 11;
			constexpr int WEAPON_IS_CARRIED_BY_PLAYER = 12;
			constexpr int WEAPON_IS_ACTIVE = 13;
			constexpr int WEAPON_PROFICIENCY_POOR = 21;
			constexpr int WEAPON_PROFICIENCY_AVERAGE = 22;
			constexpr int WEAPON_PROFICIENCY_GOOD = 23;
			constexpr int WEAPON_PROFICIENCY_VERY_GOOD = 24;
			constexpr int WEAPON_PROFICIENCY_PERFECT = 25;
			constexpr int EMPTY = 31;
			constexpr int SINGLE = 32;
			constexpr int SINGLE_NPC = 33;
			constexpr int WPN_DOUBLE = 34;
			constexpr int DOUBLE_NPC = 35;
			constexpr int BURST = 36;
			constexpr int RELOAD = 37;
			constexpr int RELOAD_NPC = 38;
			constexpr int MELEE_MISS = 39;
			constexpr int MELEE_HIT = 40;
			constexpr int MELEE_HIT_WORLD = 41;
			constexpr int SPECIAL1 = 42;
			constexpr int SPECIAL2 = 43;
			constexpr int SPECIAL3 = 44;
#ifdef SOURCEJS_HAS_WEAPON_SOUND_TAUNT
			constexpr int TAUNT = 45;
#endif
#ifdef SOURCEJS_HAS_WEAPON_SOUND_UNKNOWN
			constexpr int UNKNOWNSOUND1 = 46;
			constexpr int UNKNOWNSOUND2 = 47;
			constexpr int UNKNOWNSOUND3 = 48;
			constexpr int UNKNOWNSOUND4 = 49;
			constexpr int UNKNOWNSOUND5 = 50;
#endif
#ifdef SOURCEJS_HAS_WEAPON_SOUND_FAST_RELOAD
			constexpr int FAST_RELOAD = 51;
#endif
#endif

@ACTUAL_WEAPON_INSTALLATION_HELPERS@

			void CreateModuleCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				constexpr int kConstantsArgumentIndex = 0;

				auto* const pIsolate = Information.GetIsolate();
				try {
					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Object> const LocalModule = MakeModule(pIsolate);
					v8::Local<v8::External> const LocalData = v8::External::New(pIsolate, &FixtureSteamInstallation::g_nHostData);
					if (LocalModule.IsEmpty() || LocalData.IsEmpty()) {
						return;
					}

					const bool bConstants = (Information.Length() > kConstantsArgumentIndex) && Information[kConstantsArgumentIndex]->IsTrue();
					const bool bInstalled = bConstants ? InstallWeaponConstants(pIsolate, LocalContext, LocalModule) : InstallWeaponPropertyAndAmmoFunctions(pIsolate, LocalContext, LocalModule, LocalData);
					if (!bInstalled) {
						return;
					}

					Information.GetReturnValue().Set(LocalModule);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled weapon installation C++ failure.");
					}
				}
			}

			void GetProfileCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				int nProfile = 0x0;
#if defined(SOURCEJS_HAS_WEAPON_SHAREDDEFS) && defined(SOURCEJS_HAS_WEAPON_PARSE) && defined(SOURCEJS_HAS_WEAPON_PROFICIENCY)
				nProfile |= 0x1;
#if defined(SOURCEJS_HAS_ITEM_FLAG_NOITEMPICKUP) && defined(SOURCEJS_HAS_WEAPON_SOUND_TAUNT) && defined(SOURCEJS_HAS_WEAPON_SOUND_UNKNOWN) && defined(SOURCEJS_HAS_WEAPON_SOUND_FAST_RELOAD)
				nProfile |= 0x2;
#endif
#endif

				Information.GetReturnValue().Set(nProfile);
			}

@WEAPON_FEATURE_RESTORE@

		} // namespace FixtureWeaponInstallation

		namespace FixtureNetChannelDataRate {

			constexpr std::size_t kChannelCount = 2;

			// SDK-shaped storage only; these records do not model the real channel ABI or lifetime.
			struct INetChannelInfo {
			};

			struct INetChannel : INetChannelInfo {
				void SetDataRate(const float flDataRate) {
					m_flDataRate = flDataRate;
					++m_unWriteCount;
				}

				float m_flDataRate;
				std::uint32_t m_unWriteCount;
			};

			constinit INetChannel g_arrChannels[kChannelCount] {};

@ACTUAL_NETCHANNEL_DATA_RATE_HELPERS@

			// V8 requires a getter; only the actual production setter is exercised here.
			void UnusedGetter(v8::Local<v8::Name>, v8::PropertyCallbackInfo<v8::Value> const&) {
			}

			void CreateReceiverCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				try {
					for (auto& Channel : g_arrChannels) {
						Channel = {};
					}

					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Object> const LocalReceiver = MakeModule(pIsolate);
					auto* const pChannelInformation = static_cast<INetChannelInfo*>(&g_arrChannels[0]);
					const std::uintptr_t unAddress = reinterpret_cast<std::uintptr_t>(pChannelInformation);
					v8::Local<v8::BigInt> const LocalAddress = v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress));
					Require(!LocalReceiver.IsEmpty() && SetRecordProperty(pIsolate, LocalContext, LocalReceiver, "Address", LocalAddress), "Create DataRate fixture receiver");
					Require(LocalReceiver->SetNativeDataProperty(LocalContext, MakeString(pIsolate, "DataRate"), UnusedGetter, SetNetChannelInformationPropertyCallback).FromMaybe(false), "Install actual DataRate setter");
					Information.GetReturnValue().Set(LocalReceiver);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled DataRate receiver construction failure.");
					}
				}
			}

			void SnapshotCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				try {
					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Array> const LocalStates = v8::Array::New(pIsolate);
					Require(!LocalStates.IsEmpty(), "Create DataRate fixture snapshots");
					for (std::uint32_t unIndex = 0; unIndex < kChannelCount; ++unIndex) {
						v8::Local<v8::Object> const LocalState = MakeModule(pIsolate);
						auto* const pChannelInformation = static_cast<INetChannelInfo*>(&g_arrChannels[unIndex]);
						const std::uintptr_t unAddress = reinterpret_cast<std::uintptr_t>(pChannelInformation);
						Require(!LocalState.IsEmpty(), "Create DataRate fixture snapshot");
						Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "Address", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress))), "Record fixture channel address");
						Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "DataRate", v8::Number::New(pIsolate, g_arrChannels[unIndex].m_flDataRate)), "Record fixture channel rate");
						Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "WriteCount", v8::Integer::NewFromUnsigned(pIsolate, g_arrChannels[unIndex].m_unWriteCount)), "Record fixture channel writes");
						Require(LocalStates->CreateDataProperty(LocalContext, unIndex, LocalState).FromMaybe(false), "Append fixture channel snapshot");
					}

					Information.GetReturnValue().Set(LocalStates);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled DataRate snapshot failure.");
					}
				}
			}

		} // namespace FixtureNetChannelDataRate

		namespace FixtureMemoryNarrowIntegers {

			constexpr int kSignedOutputSentinel = -123456;
			constexpr std::uint32_t kUnsignedOutputSentinel = 123456;
			constexpr char kIntegerInputErrorMessage[] = "Controlled bounded integer input failure.";

			constinit int g_nSignedOutput = kSignedOutputSentinel;
			constinit std::uint32_t g_unUnsignedOutput = kUnsignedOutputSentinel;
			constinit bool g_bSucceeded = false;

@ACTUAL_MEMORY_NARROW_INTEGER_HELPERS@

			void ResetOutputs() noexcept {
				g_nSignedOutput = kSignedOutputSentinel;
				g_unUnsignedOutput = kUnsignedOutputSentinel;
				g_bSucceeded = false;
			}

			void ReadSignedCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				constexpr int kValueArgumentIndex = 0;
				constexpr int kMinimumArgumentIndex = 1;
				constexpr int kMaximumArgumentIndex = 2;
				constexpr int kRequiredArgumentCount = 3;

				auto* const pIsolate = Information.GetIsolate();
				try {
					ResetOutputs();
					Require((Information.Length() == kRequiredArgumentCount) && Information[kMinimumArgumentIndex]->IsInt32() && Information[kMaximumArgumentIndex]->IsInt32(), "Signed integer fixture bounds");
					const int nMinimum = Information[kMinimumArgumentIndex].As<v8::Int32>()->Value();
					const int nMaximum = Information[kMaximumArgumentIndex].As<v8::Int32>()->Value();
					g_bSucceeded = RequireMemoryInt32InRangeFromValue(pIsolate, pIsolate->GetCurrentContext(), Information[kValueArgumentIndex], kIntegerInputErrorMessage, nMinimum, nMaximum, g_nSignedOutput);
					Information.GetReturnValue().Set(g_bSucceeded);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled signed integer fixture failure.");
					}
				}
			}

			void ReadUnsignedCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				constexpr int kValueArgumentIndex = 0;
				constexpr int kMaximumArgumentIndex = 1;
				constexpr int kRequiredArgumentCount = 2;

				auto* const pIsolate = Information.GetIsolate();
				try {
					ResetOutputs();
					Require((Information.Length() == kRequiredArgumentCount) && Information[kMaximumArgumentIndex]->IsUint32(), "Unsigned integer fixture bound");
					const std::uint32_t unMaximum = Information[kMaximumArgumentIndex].As<v8::Uint32>()->Value();
					g_bSucceeded = RequireMemoryUInt32AtMostFromValue(pIsolate, pIsolate->GetCurrentContext(), Information[kValueArgumentIndex], kIntegerInputErrorMessage, unMaximum, g_unUnsignedOutput);
					Information.GetReturnValue().Set(g_bSucceeded);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled unsigned integer fixture failure.");
					}
				}
			}

			void SnapshotCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				try {
					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Object> const LocalState = MakeModule(pIsolate);
					Require(!LocalState.IsEmpty(), "Create bounded integer state");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "Signed", v8::Integer::New(pIsolate, g_nSignedOutput)), "Record signed integer output");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "Unsigned", v8::Integer::NewFromUnsigned(pIsolate, g_unUnsignedOutput)), "Record unsigned integer output");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalState, "Succeeded", v8::Boolean::New(pIsolate, g_bSucceeded)), "Record bounded integer status");
					Information.GetReturnValue().Set(LocalState);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled bounded integer snapshot failure.");
					}
				}
			}

		} // namespace FixtureMemoryNarrowIntegers

		namespace FixtureMemoryVirtualFunctions {

			constexpr std::size_t kVirtualSlotCount = 2;

			constinit int g_nFirstMarker = 1;
			constinit int g_nSecondMarker = 2;
			constinit void* g_arrVirtualTable[kVirtualSlotCount] {};
			constinit void* g_arrReplacementTable[kVirtualSlotCount] {};
			constinit void** g_ppVirtualTable = nullptr;

@ACTUAL_MEMORY_VIRTUAL_FUNCTION_HELPERS@

			void CreateCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				auto* const pIsolate = Information.GetIsolate();
				try {
					g_arrVirtualTable[0] = &g_nFirstMarker;
					g_arrVirtualTable[1] = &g_nSecondMarker;
					g_arrReplacementTable[0] = &g_nSecondMarker;
					g_arrReplacementTable[1] = &g_nFirstMarker;
					g_ppVirtualTable = g_arrVirtualTable;

					v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
					v8::Local<v8::Object> const LocalRecord = MakeModule(pIsolate);
					Require(!LocalRecord.IsEmpty(), "Create controlled virtual-table record");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalRecord, "ObjectAddress", MakeMemoryAddressValue(pIsolate, reinterpret_cast<std::uintptr_t>(&g_ppVirtualTable))), "Record controlled object address");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalRecord, "FirstAddress", MakeMemoryAddressValue(pIsolate, reinterpret_cast<std::uintptr_t>(&g_nFirstMarker))), "Record first marker address");
					Require(SetRecordProperty(pIsolate, LocalContext, LocalRecord, "SecondAddress", MakeMemoryAddressValue(pIsolate, reinterpret_cast<std::uintptr_t>(&g_nSecondMarker))), "Record second marker address");
					Information.GetReturnValue().Set(LocalRecord);
				} catch (...) {
					if (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
						ThrowError(pIsolate, "Controlled virtual-table fixture failure.");
					}
				}
			}

			void DetachCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				g_ppVirtualTable = nullptr;
				Information.GetReturnValue().Set(true);
			}

			void ReplaceCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				g_ppVirtualTable = g_arrReplacementTable;
				Information.GetReturnValue().Set(true);
			}

			void ClearSlotCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
				g_arrVirtualTable[1] = nullptr;
				Information.GetReturnValue().Set(true);
			}

		} // namespace FixtureMemoryVirtualFunctions

		void ResetFullCallbackFixture(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			if (g_unLiveKeyValues != 0) {
				g_bNativeInvariantFailed = true;
				ThrowError(Information.GetIsolate(), "Previous callback leaked KeyValues");
				return;
			}

			ResetFixtureCallback(Information);
			g_unDialogDispatches = 0;
			g_bDispatchUsedCurrentEdict = false;
			g_nDialogUserID = kFixtureInvalidUserID;
			g_bMutateKeyValuesRecipient = false;
			g_SteamID = kInitialSteamID;
			g_bSteamConstructionMutation = false;
		}

		void GetFullCallbackState(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			constexpr std::size_t kLiveKeyValuesStateScale = 100;

			const std::uint32_t unState = static_cast<std::uint32_t>(g_unDialogDispatches + (g_unLiveKeyValues * kLiveKeyValuesStateScale));
			Information.GetReturnValue().Set(unState);
		}

		void GetDispatchUserID(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			Information.GetReturnValue().Set(g_bDispatchUsedCurrentEdict ? g_nDialogUserID : kFixtureInvalidUserID);
		}

		void MutateKeyValuesRecipient(v8::FunctionCallbackInfo<v8::Value> const&) {
			g_bMutateKeyValuesRecipient = true;
		}

		void MakeSteamFieldsCallback(v8::FunctionCallbackInfo<v8::Value> const& Information) {
			auto* const pIsolate = Information.GetIsolate();
			try {
				g_bSteamConstructionMutation = true;
				v8::Local<v8::Object> const LocalFields = MakeSteamIDFieldsObject(pIsolate, pIsolate->GetCurrentContext(), g_SteamID);
				if (g_bSteamConstructionMutation) {
					g_bSteamConstructionMutation = false;
					ThrowError(pIsolate, "Steam construction-entry probe did not run.");
					return;
				}

				if (!LocalFields.IsEmpty()) {
					Information.GetReturnValue().Set(LocalFields);
				}
			} catch (...) {
				ThrowError(pIsolate, "Controlled Steam factory C++ failure");
			}
		}

		void RunChecks(v8::Isolate* const pIsolate) {
			constexpr std::pair<char const*, v8::FunctionCallback> kCallbacks[] = {
				{ "ResetFixture", ResetFixtureCallback },
				{ "MutateRecipient", MutateRecipientCallback },
				{ "Recipient", RecipientCallback },
				{ "UInt32", UInt32Callback },
				{ "CreateDialog", CreateMessagesDialogCallback },
				{ "ShowText", ShowMenusTextCallback },
				{ "HideText", HideMenusTextCallback },
				{ "ResetFullFixture", ResetFullCallbackFixture },
				{ "GetFullCallbackState", GetFullCallbackState },
				{ "GetDispatchUserID", GetDispatchUserID },
				{ "MutateKeyValuesRecipient", MutateKeyValuesRecipient },
				{ "MakeSteamFields", MakeSteamFieldsCallback },
				{ "CreateSteamInstallation", FixtureSteamInstallation::CreateModuleCallback },
				{ "GetSteamInstallationProfile", FixtureSteamInstallation::GetProfileCallback },
				{ "CreateAuthenticationInstallation", CreateAuthenticationInstallationCallback },
				{ "CreateWeaponInstallation", FixtureWeaponInstallation::CreateModuleCallback },
				{ "GetWeaponInstallationProfile", FixtureWeaponInstallation::GetProfileCallback },
				{ "CreateNetChannelDataRate", FixtureNetChannelDataRate::CreateReceiverCallback },
				{ "GetNetChannelDataRateStates", FixtureNetChannelDataRate::SnapshotCallback },
				{ "ReadSignedNarrowInteger", FixtureMemoryNarrowIntegers::ReadSignedCallback },
				{ "ReadUnsignedNarrowInteger", FixtureMemoryNarrowIntegers::ReadUnsignedCallback },
				{ "GetNarrowIntegerState", FixtureMemoryNarrowIntegers::SnapshotCallback },
				{ "CreateMemoryVirtualFunctionFixture", FixtureMemoryVirtualFunctions::CreateCallback },
				{ "GetMemoryVirtualFunction", FixtureMemoryVirtualFunctions::GetMemoryHelpersVirtualFunctionCallback },
				{ "DetachMemoryVirtualTable", FixtureMemoryVirtualFunctions::DetachCallback },
				{ "ReplaceMemoryVirtualTable", FixtureMemoryVirtualFunctions::ReplaceCallback },
				{ "ClearMemoryVirtualSlot", FixtureMemoryVirtualFunctions::ClearSlotCallback },
				{ "GetLastDialogType", GetLastDialogTypeCallback },
			};

			v8::HandleScope HandleScope(pIsolate);
			v8::Local<v8::Context> const LocalContext = v8::Context::New(pIsolate);
			v8::Context::Scope ContextScope(LocalContext);
			v8::TryCatch Failure(pIsolate);

			for (auto const& Entry : kCallbacks) {
				v8::Local<v8::Function> LocalFunction {};
				Require(v8::Function::New(LocalContext, Entry.second).ToLocal(&LocalFunction), "Create fixture callback");
				Require(LocalContext->Global()->Set(LocalContext, MakeString(pIsolate, Entry.first), LocalFunction).FromMaybe(false), "Publish fixture callback");
			}

			v8::Local<v8::Script> LocalScript {};
			Require(v8::Script::Compile(LocalContext, MakeString(pIsolate, R"JS(
"use strict";

(() => {
	const nPlayerIndex = 4;
	const nInitialUserID = 42;
	const nFreeEdictMutation = 0;
	const nNegativeUserIDMutation = 1;
	const nChangedUserIDMutation = 2;
	const nReplacedEdictMutation = 3;
	const nDetachedEdictMutation = 4;
	const nZeroUserIDMutation = 5;
	const nDialogTextType = 2;
	const unMenuDisplayTime = 10;
	const unMaximumUInt32Value = 0xFFFFFFFF;
	const unOverflowUInt32Value = unMaximumUInt32Value + 1;

	function Require(bCondition) {
		if (!bCondition) {
			throw new Error("Contract assertion failed");
		}
	}

	function Reject(Callback) {
		let bRejected = false;
		try {
			Callback();
		} catch (Failure) {
			bRejected = Failure instanceof Error;
		}

		Require(bRejected);
	}

	function RequireOriginal(Callback, Original) {
		let bOriginal = false;
		try {
			Callback();
		} catch (Failure) {
			bOriginal = Failure === Original;
		}

		Require(bOriginal);
		Require(GetFullCallbackState() === 0);
	}

	const vecValid = [[0, 0], [unMaximumUInt32Value, unMaximumUInt32Value], [0n, 0], [4294967295n, unMaximumUInt32Value], ["0", 0], [" +17", 17], ["077", 63], ["0xFFFFFFFF", unMaximumUInt32Value]];
	for (const vecCase of vecValid) {
		Require(UInt32(vecCase[0]) === vecCase[1]);
	}

	for (const Value of ["-1", " -18446744073709551615", " -0", "1\0junk", "1\0", "", " ", "1tail", "4294967296", "18446744073709551616", -1, 1.5, Infinity, NaN, unOverflowUInt32Value, -1n, 4294967296n, null, undefined, {}]) {
		Reject(() => UInt32(Value));
	}

	for (const nMode of [nFreeEdictMutation, nNegativeUserIDMutation, nChangedUserIDMutation, nDetachedEdictMutation]) {
		ResetFixture();
		Reject(() => Recipient(nPlayerIndex, () => MutateRecipient(nMode)));
	}

	ResetFixture();
	Require(Recipient(nPlayerIndex, () => MutateRecipient(nReplacedEdictMutation)) === true);

	ResetFixture();
	MutateRecipient(nZeroUserIDMutation);
	Require(Recipient(nPlayerIndex, () => {}) === true);

	ResetFixture();
	MutateRecipient(nNegativeUserIDMutation);
	Reject(() => Recipient(nPlayerIndex, () => {
		throw new Error("Must not run");
	}));

	ResetFixture();
	let unIndexReads = 0;
	const Player = {
		get Index() {
			++unIndexReads;

			return nPlayerIndex;
		},
	};
	Require(Recipient(Player, () => {}) === true);
	Require(unIndexReads === 1);

	ResetFixture();
	const Original = new Error("Original callback error");
	let bOriginal = false;
	try {
		Recipient(nPlayerIndex, () => {
			MutateRecipient(nChangedUserIDMutation);
			throw Original;
		});
	} catch (Failure) {
		bOriginal = Failure === Original;
	}

	Require(bOriginal);

	ResetFullFixture();
	const nLastDialogType = GetLastDialogType();
	Require(CreateDialog(nPlayerIndex, nLastDialogType, {}) === true);
	Require(GetFullCallbackState() === 1);

	ResetFullFixture();
	Reject(() => CreateDialog(nPlayerIndex, nLastDialogType + 1, {}));
	Require(GetFullCallbackState() === 0);

	for (const nMode of [nFreeEdictMutation, nNegativeUserIDMutation, nChangedUserIDMutation, nDetachedEdictMutation]) {
		ResetFullFixture();
		const Fields = {
			get Title() {
				MutateRecipient(nMode);

				return "Rules";
			},
		};
		Reject(() => CreateDialog(nPlayerIndex, nDialogTextType, Fields));
		Require(GetFullCallbackState() === 0);
	}

	ResetFullFixture();
	const RefreshFields = {
		get Title() {
			MutateRecipient(nReplacedEdictMutation);

			return "Refreshed recipient";
		},
	};
	Require(CreateDialog(nPlayerIndex, nDialogTextType, RefreshFields) === true);
	Require(GetFullCallbackState() === 1);
	Require(GetDispatchUserID() === nInitialUserID);

	ResetFullFixture();
	const EnumerationFields = new Proxy({ Title: "Rules" }, {
		ownKeys(Target) {
			MutateRecipient(nChangedUserIDMutation);

			return Reflect.ownKeys(Target);
		},
	});
	Reject(() => CreateDialog(nPlayerIndex, nDialogTextType, EnumerationFields));
	Require(GetFullCallbackState() === 0);

	ResetFullFixture();
	const NestedFields = {
		Section: {
			Color: {
				get Red() {
					MutateRecipient(nChangedUserIDMutation);

					return 1;
				},
				Green: 2,
				Blue: 3,
			},
		},
	};
	Reject(() => CreateDialog(nPlayerIndex, nDialogTextType, NestedFields));
	Require(GetFullCallbackState() === 0);

	for (const strPhase of ["Enumeration", "Field", "Color"]) {
		ResetFullFixture();
		const Original = new Error(strPhase + " original error");
		let Fields = null;
		if (strPhase === "Enumeration") {
			Fields = new Proxy({}, {
				ownKeys() {
					MutateRecipient(nChangedUserIDMutation);
					throw Original;
				},
			});
		} else if (strPhase === "Field") {
			Fields = {
				get Title() {
					MutateRecipient(nChangedUserIDMutation);
					throw Original;
				},
			};
		} else {
			Fields = {
				Color: {
					Red: 1,
					Green: 2,
					Blue: 3,
					get Alpha() {
						MutateRecipient(nChangedUserIDMutation);
						throw Original;
					},
				},
			};
		}

		RequireOriginal(() => CreateDialog(nPlayerIndex, nDialogTextType, Fields), Original);
	}

	for (const Invoke of [
		Player => CreateDialog(Player, nDialogTextType, { Title: "Rules" }),
		Player => ShowText(Player, "Title", "Message", unMenuDisplayTime),
		Player => HideText(Player),
	]) {
		ResetFullFixture();
		const Original = new Error("Index getter original error");
		const Player = {
			get Index() {
				throw Original;
			},
		};
		RequireOriginal(() => Invoke(Player), Original);

		ResetFullFixture();
		let unIndexReads = 0;
		const StablePlayer = {
			get Index() {
				++unIndexReads;

				return nPlayerIndex;
			},
		};
		Require(Invoke(StablePlayer) === true);
		Require(unIndexReads === 1);
		Require(GetFullCallbackState() === 1);

		ResetFullFixture();
		MutateKeyValuesRecipient();
		Reject(() => Invoke(nPlayerIndex));
		Require(GetFullCallbackState() === 0);
	}

	ResetFullFixture();
	let unNumericCoercions = 0;
	const NonPrimitiveNumber = {
		valueOf() {
			++unNumericCoercions;

			return unMenuDisplayTime;
		},
	};
	Reject(() => ShowText(nPlayerIndex, "Title", "Message", NonPrimitiveNumber));
	Reject(() => CreateDialog(nPlayerIndex, NonPrimitiveNumber, {}));
	Require(unNumericCoercions === 0);
	Require(GetFullCallbackState() === 0);

	ResetFullFixture();
	const SteamSnapshot = MakeSteamFields();
	if ((SteamSnapshot.AccountID !== 11) || (SteamSnapshot.AccountInstance !== 2) || (SteamSnapshot.AccountType !== 3) || (SteamSnapshot.Universe !== 4) || (SteamSnapshot.StaticAccountKey !== 91n) || (SteamSnapshot.Value !== 117n) || (SteamSnapshot.Valid !== true)) {
		throw new Error("Preserve SteamID owned snapshot during output construction");
	}

	function HasOwnSteamFields(SteamFields) {
		if ((SteamFields === null) || (typeof SteamFields !== "object") || (Object.getPrototypeOf(SteamFields) !== Object.prototype)) {
			return false;
		}

		const vecExpected = [
			{ Name: "AccountID", Value: 11 },
			{ Name: "AccountInstance", Value: 2 },
			{ Name: "AccountType", Value: 3 },
			{ Name: "Universe", Value: 4 },
			{ Name: "StaticAccountKey", Value: 91n },
			{ Name: "Value", Value: 117n },
			{ Name: "Valid", Value: true },
		];

		return vecExpected.every(Expected => {
			const Descriptor = Object.getOwnPropertyDescriptor(SteamFields, Expected.Name);

			return !!Descriptor && Object.hasOwn(Descriptor, "value") && (Descriptor.value === Expected.Value) && Descriptor.writable && Descriptor.enumerable && Descriptor.configurable;
		});
	}

	// Scalar readback must not execute inherited accessors or reuse inherited data.
	for (const strName of ["AccountID", "AccountInstance", "AccountType", "Universe", "StaticAccountKey", "Value", "Valid"]) {
		for (const ErrorValue of [undefined, null, Symbol("SteamPrefix"), new Error("SteamPrefix"), false, true]) {
			ResetFullFixture();
			let unSteamAccessorCalls = 0;
			const Reject = () => {
				++unSteamAccessorCalls;
				throw ErrorValue;
			};
			const InheritedDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, strName);
			const bDataProperty = (ErrorValue === false) || (ErrorValue === true);
			Object.defineProperty(Object.prototype, strName, bDataProperty ? { configurable: true, writable: ErrorValue, value: "Inherited" } : { configurable: true, get: Reject, set: Reject });
			let SteamFields = null;
			try {
				SteamFields = MakeSteamFields();
			} catch {
				throw new Error("Preserve own SteamID fields");
			} finally {
				if (InheritedDescriptor === undefined) {
					delete Object.prototype[strName];
				} else {
					Object.defineProperty(Object.prototype, strName, InheritedDescriptor);
				}
			}

			if ((unSteamAccessorCalls !== 0) || !HasOwnSteamFields(SteamFields)) {
				throw new Error("Preserve own SteamID fields");
			}
		}
	}

	ResetFullFixture();

	const unL4D2InstallationProfileMask = 0x1;
	const unBMSInstallationProfileMask = 0x2;
	const unLegacyInstallationProfileMask = 0x4;
	const unModuleMetadataFieldCount = 3;
	const unExpectedSteamIDByteCount = 8;
	const nExpectedHostData = 73;
	const unInstallationProfile = GetSteamInstallationProfile();
	const bLegacyInstallation = (unInstallationProfile & unLegacyInstallationProfileMask) !== 0;
	const vecCommonMethods = [
		"SteamIDNormalize",
		"SteamIDParse",
		"SteamIDFields",
		"SteamIDSet",
		"SteamIDInstancedSet",
		"SteamIDFullSet",
		"SteamIDCreateBlankAnonymousLogon",
		"SteamIDCreateBlankAnonymousUserAccount",
		"SteamIDClear",
		"SteamIDStaticAccountKey",
		"SteamIDToSteamID3",
	];
	const vecModernMethods = [
		"SteamIDClearIndividualInstance",
		"SteamIDToSteamID2",
		"SteamIDIsValid",
		"SteamIDIsBlankAnonymousAccount",
		"SteamIDIsGameServerAccount",
		"SteamIDIsPersistentGameServerAccount",
		"SteamIDIsAnonymousGameServerAccount",
		"SteamIDIsContentServerAccount",
		"SteamIDIsClanAccount",
		"SteamIDIsChatAccount",
		"SteamIDIsLobby",
		"SteamIDIsIndividualAccount",
		"SteamIDIsAnonymousUserAccount",
		"SteamIDIsAnonymousAccount",
		"SteamIDIsConsoleUserAccount",
		"SteamIDHasNoIndividualInstance",
	];
	const vecMethods = [...vecCommonMethods, ...(bLegacyInstallation ? [] : vecModernMethods)];
	const UniverseValues = {
		Invalid: 0,
		Public: 1,
		Beta: 2,
		Internal: 3,
		Development: 4,
		Maximum: 5,
	};
	const AccountTypeValues = {
		Invalid: 0,
		Individual: 1,
		Multiseat: 2,
		GameServer: 3,
		AnonymousGameServer: 4,
		Pending: 5,
		ContentServer: 6,
		Clan: 7,
		Chat: 8,
		AnonymousUser: 10,
	};
	if ((unInstallationProfile & unL4D2InstallationProfileMask) !== 0) {
		AccountTypeValues.P2PSuperSeeder = 9;
	} else if ((unInstallationProfile & unBMSInstallationProfileMask) !== 0) {
		AccountTypeValues.ConsoleUser = 9;
	}

	function CheckSteamInstallation(Module) {
		const CheckDataProperty = (Record, strName) => {
			const Descriptor = Object.getOwnPropertyDescriptor(Record, strName);
			if (!Descriptor || !Object.hasOwn(Descriptor, "value") || !Descriptor.writable || !Descriptor.enumerable || !Descriptor.configurable) {
				throw new Error("Preserve Steam installation own records");
			}

			return Descriptor.value;
		};

		const CheckRecord = (Record, Expected) => {
			if ((Record === null) || (typeof Record !== "object") || (Object.getPrototypeOf(Record) !== Object.prototype) || (Object.keys(Record).length !== Object.keys(Expected).length)) {
				throw new Error("Preserve Steam installation own records");
			}

			for (const strName of Object.keys(Expected)) {
				if (CheckDataProperty(Record, strName) !== Expected[strName]) {
					throw new Error("Preserve Steam installation own records");
				}
			}
		};

		if ((Module === null) || (typeof Module !== "object") || (Object.getPrototypeOf(Module) !== Object.prototype) || (Object.keys(Module).length !== (vecMethods.length + unModuleMetadataFieldCount))) {
			throw new Error("Preserve Steam installation own records");
		}

		for (const strName of vecMethods) {
			const Method = CheckDataProperty(Module, strName);
			if ((typeof Method !== "function") || (Method() !== nExpectedHostData)) {
				throw new Error("Preserve Steam installation own records");
			}
		}

		if (CheckDataProperty(Module, "STEAM_ID_SIZE") !== unExpectedSteamIDByteCount) {
			throw new Error("Preserve Steam installation own records");
		}

		CheckRecord(CheckDataProperty(Module, "Universe"), UniverseValues);
		CheckRecord(CheckDataProperty(Module, "AccountType"), AccountTypeValues);
	}

	CheckSteamInstallation(CreateSteamInstallation());
	const vecInstallationProperties = [...new Set([...vecMethods, "STEAM_ID_SIZE", "Universe", "AccountType", ...Object.keys(UniverseValues), ...Object.keys(AccountTypeValues)])];
	for (const strName of vecInstallationProperties) {
		for (const ErrorValue of [undefined, null, Symbol("SteamInstallation"), new Error("SteamInstallation"), false, true]) {
			let unAccessorCalls = 0;
			const Reject = () => {
				++unAccessorCalls;
				throw ErrorValue;
			};
			const InheritedDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, strName);
			const bDataProperty = (ErrorValue === false) || (ErrorValue === true);
			Object.defineProperty(Object.prototype, strName, bDataProperty ? { configurable: true, writable: ErrorValue, value: "Inherited" } : { configurable: true, get: Reject, set: Reject });
			let Module = null;
			try {
				Module = CreateSteamInstallation();
			} catch {
				throw new Error("Preserve Steam installation own records");
			} finally {
				if (InheritedDescriptor === undefined) {
					delete Object.prototype[strName];
				} else {
					Object.defineProperty(Object.prototype, strName, InheritedDescriptor);
				}
			}

			if (unAccessorCalls !== 0) {
				throw new Error("Preserve Steam installation own records");
			}

			CheckSteamInstallation(Module);
		}
	}
)JS"
R"JS(
	const vecAuthenticationMethods = [
		"NetworkID",
		"Reload",
		"Save",
		"Players",
		"Parents",
		"GetPlayer",
		"GetParent",
		"HasPlayerPermission",
		"HasParentPermission",
		"AddPlayerPermission",
		"RemovePlayerPermission",
		"AddPlayerParent",
		"RemovePlayerParent",
		"AddParentPermission",
		"RemoveParentPermission",
		"AddParentParent",
		"RemoveParentParent",
	];
	const vecSQLAuthenticationMethods = [
		"NetworkID",
		"Path",
		"Reload",
		"Save",
		"Players",
		"Parents",
		"GetPlayer",
		"GetParent",
		"HasPlayerPermission",
		"HasParentPermission",
		"AddPlayerPermission",
		"RemovePlayerPermission",
		"AddPlayerParent",
		"RemovePlayerParent",
		"AddParentPermission",
		"RemoveParentPermission",
		"AddParentParent",
		"RemoveParentParent",
		"ExportFlatFile",
		"ImportFlatFile",
		"WaitForRequest",
	];

	function CheckAuthenticationInstallation(Module, vecMethodNames) {
		if ((Module === null) || (typeof Module !== "object") || (Object.getPrototypeOf(Module) !== Object.prototype) || (Object.keys(Module).length !== vecMethodNames.length)) {
			throw new Error("Preserve authentication installation own records");
		}

		for (const strName of vecMethodNames) {
			const Descriptor = Object.getOwnPropertyDescriptor(Module, strName);
			if (!Descriptor || !Object.hasOwn(Descriptor, "value") || !Descriptor.writable || !Descriptor.enumerable || !Descriptor.configurable || (typeof Descriptor.value !== "function") || (Descriptor.value() !== nExpectedHostData)) {
				throw new Error("Preserve authentication installation own records");
			}
		}
	}

	for (const Profile of [
		{ SQLBackend: false, Methods: vecAuthenticationMethods },
		{ SQLBackend: true, Methods: vecSQLAuthenticationMethods },
	]) {
		CheckAuthenticationInstallation(CreateAuthenticationInstallation(Profile.SQLBackend), Profile.Methods);

		for (const strName of Profile.Methods) {
			for (const ErrorValue of [undefined, null, Symbol("AuthenticationInstallation"), new Error("AuthenticationInstallation"), false, true]) {
				let unAccessorCalls = 0;
				const Reject = () => {
					++unAccessorCalls;
					throw ErrorValue;
				};
				const InheritedDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, strName);
				const bDataProperty = (ErrorValue === false) || (ErrorValue === true);
				Object.defineProperty(Object.prototype, strName, bDataProperty ? { configurable: true, writable: ErrorValue, value: "Inherited" } : { configurable: true, get: Reject, set: Reject });
				let Module = null;
				try {
					Module = CreateAuthenticationInstallation(Profile.SQLBackend);
				} catch {
					throw new Error("Preserve authentication installation own records");
				} finally {
					if (InheritedDescriptor === undefined) {
						delete Object.prototype[strName];
					} else {
						Object.defineProperty(Object.prototype, strName, InheritedDescriptor);
					}
				}

				if (unAccessorCalls !== 0) {
					throw new Error("Preserve authentication installation own records");
				}

				CheckAuthenticationInstallation(Module, Profile.Methods);
			}
		}
	}
)JS"
R"JS(
	const vecWeaponMethodNames = [
		"GetProperty",
		"SetProperty",
		"GetPropertyInteger",
		"SetPropertyInteger",
		"GetPropertyFloat",
		"SetPropertyFloat",
		"GetPropertyString",
		"SetPropertyString",
		"GetPropertyStringArray",
		"SetPropertyStringArray",
		"GetPropertyEntity",
		"SetPropertyEntity",
		"GetAmmo",
		"SetAmmo",
	];
	const WeaponMethods = Object.fromEntries(vecWeaponMethodNames.map(strName => [strName, null]));
	const WeaponConstants = {
		INVALID_WEAPON_INDEX: -1,
		CLASS_PREFIX: "weapon_",
		ENTITY_CLASS_PREFIX: "weapon_",
	};
	const nWeaponInstallationProfile = GetWeaponInstallationProfile();
	Require([0x0, 0x1, 0x3].includes(nWeaponInstallationProfile));

	if ((nWeaponInstallationProfile & 0x1) !== 0) {
		WeaponConstants.ItemFlags = {
			SelectOnEmpty: 0x1,
			NoAutoReload: 0x2,
			NoAutoSwitchEmpty: 0x4,
			LimitInWorld: 0x8,
			Exhaustible: 0x10,
			DoHitLocationDamage: 0x20,
			NoAmmoPickups: 0x40,
		};
		WeaponConstants.WeaponState = {
			NotCarried: 11,
			CarriedByPlayer: 12,
			Active: 13,
		};
		WeaponConstants.WeaponProficiency = {
			Poor: 21,
			Average: 22,
			Good: 23,
			VeryGood: 24,
			Perfect: 25,
		};
		WeaponConstants.WeaponSound = {
			Empty: 31,
			Single: 32,
			SingleNPC: 33,
			Double: 34,
			DoubleNPC: 35,
			Burst: 36,
			Reload: 37,
			ReloadNPC: 38,
			MeleeMiss: 39,
			MeleeHit: 40,
			MeleeHitWorld: 41,
			Special1: 42,
			Special2: 43,
			Special3: 44,
		};
	}

	if ((nWeaponInstallationProfile & 0x2) !== 0) {
		WeaponConstants.ItemFlags.NoItemPickup = 0x80;
		Object.assign(WeaponConstants.WeaponSound, {
			Taunt: 45,
			Unknown1: 46,
			Unknown2: 47,
			Unknown3: 48,
			Unknown4: 49,
			Unknown5: 50,
			FastReload: 51,
		});
	}

	function CheckWeaponRecord(Record, Expected) {
		if ((Record === null) || (typeof Record !== "object") || (Object.getPrototypeOf(Record) !== Object.prototype) || (Reflect.ownKeys(Record).length !== Object.keys(Expected).length)) {
			throw new Error("Preserve weapon installation own records");
		}

		for (const strName of Object.keys(Expected)) {
			const Descriptor = Object.getOwnPropertyDescriptor(Record, strName);
			if (!Descriptor || !Object.hasOwn(Descriptor, "value") || !Descriptor.writable || !Descriptor.enumerable || !Descriptor.configurable) {
				throw new Error("Preserve weapon installation own records");
			}

			const ExpectedValue = Expected[strName];
			if (ExpectedValue === null) {
				if ((typeof Descriptor.value !== "function") || (Descriptor.value() !== nExpectedHostData)) {
					throw new Error("Preserve weapon installation own records");
				}
			} else if (typeof ExpectedValue === "object") {
				CheckWeaponRecord(Descriptor.value, ExpectedValue);
			} else if (Descriptor.value !== ExpectedValue) {
				throw new Error("Preserve weapon installation own records");
			}
		}
	}

	for (const Profile of [
		{ Constants: false, Expected: WeaponMethods },
		{ Constants: true, Expected: WeaponConstants },
	]) {
		CheckWeaponRecord(CreateWeaponInstallation(Profile.Constants), Profile.Expected);

		const vecNames = Object.keys(Profile.Expected).flatMap(strName => {
			const ExpectedValue = Profile.Expected[strName];

			return ((ExpectedValue !== null) && (typeof ExpectedValue === "object")) ? [strName, ...Object.keys(ExpectedValue)] : [strName];
		});
		for (const strName of vecNames) {
			for (const ErrorValue of [undefined, null, Symbol("WeaponInstallation"), new Error("WeaponInstallation"), false, true]) {
				let unAccessorCalls = 0;
				const Reject = () => {
					++unAccessorCalls;
					throw ErrorValue;
				};
				const InheritedDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, strName);
				const bDataProperty = (ErrorValue === false) || (ErrorValue === true);
				Object.defineProperty(Object.prototype, strName, bDataProperty ? { configurable: true, writable: ErrorValue, value: "Inherited" } : { configurable: true, get: Reject, set: Reject });
				let Module = null;
				try {
					Module = CreateWeaponInstallation(Profile.Constants);
				} catch {
					throw new Error("Preserve weapon installation own records");
				} finally {
					if (InheritedDescriptor === undefined) {
						delete Object.prototype[strName];
					} else {
						Object.defineProperty(Object.prototype, strName, InheritedDescriptor);
					}
				}

				if (unAccessorCalls !== 0) {
					throw new Error("Preserve weapon installation own records");
				}

				CheckWeaponRecord(Module, Profile.Expected);
			}
		}
	}
)JS"
R"JS(
	let DataRateReceiver = CreateNetChannelDataRate();
	const vecInitialChannelStates = GetNetChannelDataRateStates();
	DataRateReceiver.DataRate = {
		valueOf() {
			// Deliberately adversarial mutation, not a supported wrapper-retargeting workflow.
			DataRateReceiver.Address = vecInitialChannelStates[1].Address;

			return 128;
		},
	};
	const vecChangedChannelStates = GetNetChannelDataRateStates();
	if ((vecChangedChannelStates[0].WriteCount !== 0) || (vecChangedChannelStates[1].WriteCount !== 1) || (vecChangedChannelStates[1].DataRate !== 128)) {
		throw new Error("Preserve netchannel DataRate address after coercion");
	}

	DataRateReceiver = CreateNetChannelDataRate();
	DataRateReceiver.DataRate = 64;
	const vecSimpleChannelStates = GetNetChannelDataRateStates();
	Require((vecSimpleChannelStates[0].WriteCount === 1) && (vecSimpleChannelStates[0].DataRate === 64) && (vecSimpleChannelStates[1].WriteCount === 0));

	function RequireDataRateError(Callback, Original) {
		let bCaught = false;
		try {
			Callback();
		} catch (ErrorValue) {
			bCaught = true;
			Require(ErrorValue === Original);
		}

		Require(bCaught);
		Require(GetNetChannelDataRateStates().every(State => State.WriteCount === 0));
	}

	for (const Original of [undefined, null, Symbol("DataRate"), new Error("DataRate")]) {
		DataRateReceiver = CreateNetChannelDataRate();
		let unAddressReads = 0;
		Object.defineProperty(DataRateReceiver, "Address", {
			configurable: true,
			get() {
				++unAddressReads;
				throw new Error("Address must not be read before failed coercion");
			},
		});
		RequireDataRateError(() => {
			DataRateReceiver.DataRate = {
				valueOf() {
					throw Original;
				},
			};
		}, Original);
		Require(unAddressReads === 0);

		DataRateReceiver = CreateNetChannelDataRate();
		let unConversions = 0;
		Object.defineProperty(DataRateReceiver, "Address", {
			configurable: true,
			get() {
				throw Original;
			},
		});
		RequireDataRateError(() => {
			DataRateReceiver.DataRate = {
				valueOf() {
					++unConversions;

					return 32;
				},
			};
		}, Original);
		Require(unConversions === 1);
	}

	for (const dblInvalidRate of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
		DataRateReceiver = CreateNetChannelDataRate();
		let unAddressReads = 0;
		Object.defineProperty(DataRateReceiver, "Address", {
			configurable: true,
			get() {
				++unAddressReads;
				throw new Error("Invalid float must not resolve the receiver address");
			},
		});
		Reject(() => {
			DataRateReceiver.DataRate = dblInvalidRate;
		});
		Require((unAddressReads === 0) && GetNetChannelDataRateStates().every(State => State.WriteCount === 0));
	}
)JS"
R"JS(
	const nSignedOutputSentinel = -123456;
	const unUnsignedOutputSentinel = 123456;
	const dblWrapValue = 2 ** 32;

	function CheckRejectedNarrowInteger(Reader, vecArguments, strFamily) {
		let bRejected = false;
		try {
			Reader(...vecArguments);
		} catch {
			bRejected = true;
		}

		const State = GetNarrowIntegerState();
		if (!bRejected || State.Succeeded || (State.Signed !== nSignedOutputSentinel) || (State.Unsigned !== unUnsignedOutputSentinel)) {
			throw new Error("Preserve memory " + strFamily + " integer source range");
		}
	}

	for (const Range of [
		{ Minimum: -128, Maximum: 127 },
		{ Minimum: -32768, Maximum: 32767 },
		{ Minimum: -2147483648, Maximum: 2147483647 },
	]) {
		for (const dblValue of [dblWrapValue, -dblWrapValue, dblWrapValue + 1, NaN, Infinity, -Infinity, 0.5, -0.5, Range.Minimum - 1, Range.Maximum + 1]) {
			CheckRejectedNarrowInteger(ReadSignedNarrowInteger, [dblValue, Range.Minimum, Range.Maximum], "signed");
		}

		for (const nValue of [Range.Minimum, 0, Range.Maximum]) {
			Require(ReadSignedNarrowInteger(nValue, Range.Minimum, Range.Maximum));
			const State = GetNarrowIntegerState();
			Require(State.Succeeded && (State.Signed === nValue) && (State.Unsigned === unUnsignedOutputSentinel));
		}
	}

	for (const unMaximum of [0, 255, 65535, 0xFFFFFFFF]) {
		for (const dblValue of [dblWrapValue, dblWrapValue + 1, -1, NaN, Infinity, -Infinity, 0.5, -0.5, unMaximum + 1]) {
			CheckRejectedNarrowInteger(ReadUnsignedNarrowInteger, [dblValue, unMaximum], "unsigned");
		}

		for (const unValue of [0, Math.floor(unMaximum / 2), unMaximum]) {
			Require(ReadUnsignedNarrowInteger(unValue, unMaximum));
			const State = GetNarrowIntegerState();
			Require(State.Succeeded && (State.Unsigned === unValue) && (State.Signed === nSignedOutputSentinel));
		}
	}

	for (const Sample of [
		{ Input: "12", Expected: 12 },
		{ Input: true, Expected: 1 },
		{ Input: null, Expected: 0 },
	]) {
		Require(ReadSignedNarrowInteger(Sample.Input, -128, 127));
		Require(GetNarrowIntegerState().Signed === Sample.Expected);
		Require(ReadUnsignedNarrowInteger(Sample.Input, 255));
		Require(GetNarrowIntegerState().Unsigned === Sample.Expected);
	}

	for (const Reader of [
		Value => ReadSignedNarrowInteger(Value, -128, 127),
		Value => ReadUnsignedNarrowInteger(Value, 255),
	]) {
		let unConversions = 0;
		Require(Reader({
			valueOf() {
				++unConversions;

				return 7;
			},
		}));
		Require(unConversions === 1);

		for (const Original of [undefined, null, Symbol("BoundedInteger"), new Error("BoundedInteger")]) {
			let bCaught = false;
			try {
				Reader({
					valueOf() {
						throw Original;
					},
				});
			} catch (ErrorValue) {
				bCaught = true;
				Require(ErrorValue === Original);
			}

			const State = GetNarrowIntegerState();
			Require(bCaught && !State.Succeeded && (State.Signed === nSignedOutputSentinel) && (State.Unsigned === unUnsignedOutputSentinel));
		}

		let bBigIntRejected = false;
		try {
			Reader(1n);
		} catch (ErrorValue) {
			bBigIntRejected = ErrorValue instanceof TypeError;
		}

		const State = GetNarrowIntegerState();
		Require(bBigIntRejected && !State.Succeeded && (State.Signed === nSignedOutputSentinel) && (State.Unsigned === unUnsignedOutputSentinel));
	}

	let unInvalidBoundsConversions = 0;
	Require(ReadSignedNarrowInteger({
		valueOf() {
			++unInvalidBoundsConversions;

			return 0;
		},
	}, 2, 1) === false);
	const InvalidBoundsState = GetNarrowIntegerState();
	Require((unInvalidBoundsConversions === 0) && !InvalidBoundsState.Succeeded && (InvalidBoundsState.Signed === nSignedOutputSentinel) && (InvalidBoundsState.Unsigned === unUnsignedOutputSentinel));
})();
)JS"
R"JS(
(() => {
	const Require = (bCondition, strContract) => {
		if (!bCondition) {
			throw new Error("Preserve " + strContract);
		}
	};
	const RequireRejected = (Callback, strContract) => {
		let bCaught = false;
		try {
			Callback();
		} catch {
			bCaught = true;
		}

		Require(bCaught, strContract);
	};

	for (const Sample of [
		{ Input: 0, Second: false },
		{ Input: 1, Second: true },
		{ Input: -0, Second: false },
		{ Input: "1", Second: true },
		{ Input: true, Second: true },
		{ Input: false, Second: false },
		{ Input: null, Second: false },
	]) {
		const Fixture = CreateMemoryVirtualFunctionFixture();
		const unExpectedAddress = Sample.Second ? Fixture.SecondAddress : Fixture.FirstAddress;
		Require(GetMemoryVirtualFunction(Fixture.ObjectAddress, Sample.Input) === unExpectedAddress, "virtual function valid index conversion");
	}

	for (const Value of [0.5, 1.5, -0.5, 2 ** 32, 2 ** 32 + 1, -(2 ** 32), -1, -(2 ** 31), 2 ** 31, NaN, Infinity, -Infinity, undefined, 1n, Symbol("index")]) {
		const Fixture = CreateMemoryVirtualFunctionFixture();
		RequireRejected(() => GetMemoryVirtualFunction(Fixture.ObjectAddress, Value), "virtual function index range");
	}

	for (const OriginalError of [new Error("virtual index"), undefined, null, Symbol("virtual error")]) {
		const Fixture = CreateMemoryVirtualFunctionFixture();
		let bCaught = false;
		try {
			GetMemoryVirtualFunction(Fixture.ObjectAddress, {
				valueOf() {
					throw OriginalError;
				},
			});
		} catch (CaughtError) {
			bCaught = CaughtError === OriginalError;
		}

		Require(bCaught, "virtual function original conversion error");
	}

	for (const Mutation of [DetachMemoryVirtualTable, ReplaceMemoryVirtualTable]) {
		const Fixture = CreateMemoryVirtualFunctionFixture();
		let unConversions = 0;
		const unAddress = GetMemoryVirtualFunction(Fixture.ObjectAddress, {
			valueOf() {
				++unConversions;
				Mutation();
				return 0;
			},
		});
		const unExpectedAddress = (Mutation === DetachMemoryVirtualTable) ? 0n : Fixture.SecondAddress;
		Require((unConversions === 1) && (unAddress === unExpectedAddress), "virtual table after index coercion");
	}

	const NullFixture = CreateMemoryVirtualFunctionFixture();
	DetachMemoryVirtualTable();
	let unUnusedIndexConversions = 0;
	for (const Value of [undefined, NaN, 0.5, 1n, Symbol("unused"), {
		valueOf() {
			++unUnusedIndexConversions;
			throw new Error("Unused virtual index");
		},
	}]) {
		let bNullSentinel = false;
		try {
			bNullSentinel = GetMemoryVirtualFunction(NullFixture.ObjectAddress, Value) === 0n;
		} catch {
			bNullSentinel = false;
		}

		Require(bNullSentinel && (unUnusedIndexConversions === 0), "null virtual table index bypass");
	}

	const EmptySlotFixture = CreateMemoryVirtualFunctionFixture();
	ClearMemoryVirtualSlot();
	Require(GetMemoryVirtualFunction(EmptySlotFixture.ObjectAddress, 1) === 0n, "null virtual function slot");
	RequireRejected(() => GetMemoryVirtualFunction(EmptySlotFixture.ObjectAddress), "virtual function required index position");
	RequireRejected(() => GetMemoryVirtualFunction("address", 0), "virtual function BigInt address contract");
})();
)JS")).ToLocal(&LocalScript), "Compile real V8 checks");

			v8::Local<v8::Value> LocalResult {};
			if (!LocalScript->Run(LocalContext).ToLocal(&LocalResult)) {
				v8::String::Utf8Value Message(pIsolate, Failure.Exception());
				throw std::runtime_error(*Message ? *Message : "V8 check failed");
			}

			Require(!g_bNativeInvariantFailed, "Native callback invariants");
		}

	} // namespace

	void RunFixture() {
		std::unique_ptr<v8::ArrayBuffer::Allocator> pAllocator(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
		Require(pAllocator != nullptr, "Create allocator");

		v8::Isolate::CreateParams Parameters {};
		Parameters.array_buffer_allocator = pAllocator.get();
		std::unique_ptr<v8::Isolate, fnDisposeIsolate> pIsolate(v8::Isolate::New(Parameters), [](v8::Isolate* const pValue) {
			pValue->Dispose();
		});
		Require(pIsolate != nullptr, "Create isolate");
		v8::Isolate::Scope IsolateScope(pIsolate.get());
		RunChecks(pIsolate.get());
	}

} // namespace SourceJS

int main() {
	constexpr int kSuccessExitCode = 0;
	constexpr int kContractFailureExitCode = 1;
	constexpr int kLifecycleFailureExitCode = 2;

	if (!v8::V8::InitializeICUDefaultLocation(nullptr)) {
		std::fputs("Messages/Steam fixture: InitializeICUDefaultLocation failed\n", stderr);
		return kLifecycleFailureExitCode;
	}

	v8::V8::InitializeExternalStartupData(nullptr);
	std::unique_ptr<v8::Platform> pPlatform = v8::platform::NewDefaultPlatform();
	if (!pPlatform) {
		std::fputs("Messages/Steam fixture: NewDefaultPlatform failed\n", stderr);
		return kLifecycleFailureExitCode;
	}

	v8::V8::InitializePlatform(pPlatform.get());

	if (!v8::V8::Initialize()) {
		std::fputs("Messages/Steam fixture: V8::Initialize failed\n", stderr);
		v8::V8::DisposePlatform();
		return kLifecycleFailureExitCode;
	}

	int nResult = kSuccessExitCode;
	try {
		SourceJS::RunFixture();
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Messages/Steam fixture: %s\n", Failure.what());
		nResult = kContractFailureExitCode;
	}

	if (!v8::V8::Dispose()) {
		std::fputs("Messages/Steam fixture: V8::Dispose failed\n", stderr);
		nResult = kLifecycleFailureExitCode;
	}

	v8::V8::DisposePlatform();

	return nResult;
}
