# Source Branches

This monorepo was initialized from snapshot imports, not git submodules. The imported directories are ordinary tracked files in this repository so this repo can become the shared source of truth.

## Current Live Branches

Checked on 2026-06-29 against `https://github.com/NewEstablishment/odysee-on-arweave`.

| Branch | Head | Commit date | Commit message | Use |
| --- | --- | --- | --- | --- |
| `rave/auth-upload` | `6211ae3` | 2026-06-26 15:00:36Z | `Fix uploads` | Current newest live reference. Local `HEAD` is on this branch. |
| `bhavyagor/auth-upload` | `0001660` | 2026-06-26 13:28:53Z | `gaps addressed` | Newest Bhavya auth/upload reference. Compare for user state, upload gaps, and route bridge work. |
| `codex/hyperbeam-auth-experiments` | `307ed9e` | 2026-06-26 05:04:23Z | `Build HyperBEAM auth upload demo` | Auth/upload demo reference. Useful for experimental docs and demo scripts, not the freshest product branch. |
| `main` | `476f258` | 2026-06-23 14:51:52Z | `byte_size length 40 checker` | Older shared baseline. |
| `bhavyagor/odysee-bridge-devices` | `33da5d2` | 2026-06-23 07:09:04Z | `hyperbeam and odysee-frontend stuff moved` | Older bridge/device baseline. Superseded for freshness by auth/upload branches. |

Freshness rule: use commit date first, then inspect branch content for relevance. As of this check, `rave/auth-upload` is the most up-to-date branch, with `bhavyagor/auth-upload` as the closest alternate reference.

## Imported Snapshot Origins

| Path | Remote | Branch | Imported commit |
| --- | --- | --- | --- |
| `hyperbeam/` | `https://github.com/permaweb/HyperBEAM.git` | `edge` | `3e610d0326e8c8e3faeb730323879b7656378568`, then ported Bhavya Odysee bridge baseline |
| `odysee-frontend/` | `https://github.com/OdyseeTeam/odysee-frontend.git` | `hyperbeam-implementation-rave` | `a70d7eb8fd1ac836e3f0f3a4bf9e81813dfbbd76` |
| `references/hyperbeam-bhavya/` | `https://github.com/permaweb/HyperBEAM.git` | `bhavyagor/odysee-bridge-devices` | `0cab8d2839f71a7840c7b3fdfd1905d398aac383` |
| `references/hyperbeam-rave/` | `https://github.com/NewEstablishment/HyperBEAM.git` | `odysee-on-hb-rave` | `43e0f6119e6ca2c15eea228308743ad807857524` |

## Update Policy

`hyperbeam/` should keep upstream `permaweb/HyperBEAM` `edge` alignment deliberate, but it is no longer a pure snapshot. It contains the selected Bhavya Odysee bridge/device port plus later auth/upload work from the live `NewEstablishment/odysee-on-arweave` branches.

`odysee-frontend/` should track the freshest agreed Odysee HyperBEAM integration branch until that work is merged or replaced. Check `NewEstablishment/odysee-on-arweave` branch dates before using older local snapshots as references.

The `references/` trees are historical comparison snapshots. Do not land new product work there. If a reference branch changes and the team wants to refresh the comparison, update the snapshot and update this file plus `aidocs/hyperbeam-approach-comparison.md` in the same change. For current branch references, prefer fetched `origin/*` refs from this monorepo over the older `references/` directories.

## Development Rule

New shared work should happen in the live source paths, not the reference paths:

- HyperBEAM base changes: `hyperbeam/`
- Odysee frontend changes: `odysee-frontend/`
- Odysee bridge/device implementation: `hyperbeam/`, with `references/hyperbeam-bhavya/` and `references/hyperbeam-rave/` used only for comparison
- Planning, setup notes, and comparison records: `aidocs/`
