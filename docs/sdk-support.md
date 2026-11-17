# Source 1 SDK Support

This matrix mirrors `SDK_BRANCHES`, `SDK_BRANCH_REFS` and
`SDK_SUPPORTED_TARGETS` in `tools/verify_project.py`. The project verifier checks
the corresponding CMake and workflow copies when HL2SDK support changes.

SourceJS configures the Source 1 SDK branch/platform/architecture targets listed
below. This is the configured support matrix, not a claim that every target was
built or tested in the current checkout. An absent table cell is intentional and
is not replaced by a stub build.

`cs2`, `dota` and `deadlock` are excluded because they are Source 2 branches
without the Source 1 VSP contract used by SourceJS.

| SDK branch | Linux x86 | Linux x64 | Windows x86 | Windows x64 | Pinned HL2SDK reference |
| --- | --- | --- | --- | --- | --- |
| `bgt` | Yes | - | Yes | - | `4ae5d9dbd614bf862f86682d9f8c95595e973288` |
| `blade` | Yes | Yes | Yes | Yes | `a736c9a6c676136f575af5056384851a8e1e788a` |
| `bms` | Yes | - | Yes | - | `51cd3e7b0b7fc81d672159c99299910a30b4c9ce` |
| `contagion` | Yes | - | Yes | - | `934ff16bbb89853c5d2825922cbfcada33b58f05` |
| `csgo` | Yes | - | Yes | - | `9cf2f325ea273559c7cae27b4f98518c18b8e322` |
| `css` | Yes | Yes | Yes | Yes | `64895cf48c68f5cef0470ee3f13ec449babc30ea` |
| `darkm` | - | - | Yes | - | `016cfd4f95e58f94131594a12b5a3aac9cd33f20` |
| `dods` | Yes | Yes | Yes | Yes | `ece187a8147a8159c16f88305e3523cef6475ecf` |
| `doi` | Yes | - | Yes | Yes | `ceefec48c282335da40a30f66bf498bd8e327d2f` |
| `episode1` | - | - | Yes | - | `4b0cde271be6806b95842e78348009712a8b3fbe` |
| `eye` | Yes | - | Yes | - | `eea369b456eddf177d32cecbb4a32c0b144d0d02` |
| `gmod` | Yes | - | Yes | - | `231e152ac20af77fbd22a4f5fa810c42004343d1` |
| `hl2dm` | Yes | Yes | Yes | Yes | `af883d5052349f09fbe641c99149b84769a62d01` |
| `insurgency` | Yes | - | Yes | Yes | `f66e087ee2993e8f09b27deed9f23c03321bd70d` |
| `l4d` | Yes | - | Yes | - | `0a8e862697335b12976a124daf728c38e975e381` |
| `l4d2` | Yes | - | Yes | - | `c2badaa4f7e763a92427ac11202c349385810cc2` |
| `mcv` | Yes | Yes | Yes | Yes | `794ff8a7cd9170c0580f91e0fb89bafc6db7a2a3` |
| `nucleardawn` | Yes | - | Yes | - | `38a4308cce4f0574d76ee36cedf20aa76054fbee` |
| `orangebox` | Yes | - | Yes | - | `88bc34abdd51421afed7bd120d457cbdc372ccfa` |
| `portal2` | - | - | Yes | - | `f61c12390436451dbd2fe64362715ee9fc1cf1af` |
| `pvkii` | Yes | - | Yes | - | `f06b74a1d44116613e398787974b78e51fb1c8b8` |
| `sdk2013` | Yes | - | Yes | - | `4c56ee5bc8bfe00793abb7d40eb3f6fb040f10d2` |
| `swarm` | - | - | Yes | - | `53355f2ea3671c8b543fca6c5a95ab884a620780` |
| `tf2` | Yes | Yes | Yes | Yes | `f8ec7a5644b58ff0c8dcd94d8b7501b447f5a82d` |

## Verification

[`build.yml`](../.github/workflows/build.yml) runs on manual dispatch for one
selected branch, platform, and architecture. It delegates the build to
[`build-sdk-branch.yml`](../.github/workflows/build-sdk-branch.yml). Verify the
synchronized configuration matrix with:

```powershell
python tools/verify_project.py
```

This checks repository contracts and runs the project's focused checks; it does
not compile the entire SDK matrix or launch game servers. Build results require
completed CI jobs or a local sweep, and successful native linking does not
replace branch-specific live-server validation.

The complete Windows and Linux sweep commands, including every required path,
are documented in [Full SDK Sweep](build-l4d2.md#full-sdk-sweep). The Linux sweep
must run on the Debian build host or another Linux environment. It is never
routed through WSL.
