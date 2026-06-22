# Source Branches

This monorepo was initialized from snapshot imports, not git submodules. The imported directories are ordinary tracked files in this repository so this repo can become the shared source of truth.

| Path | Remote | Branch | Imported commit |
| --- | --- | --- | --- |
| `hyperbeam/` | `https://github.com/permaweb/HyperBEAM.git` | `edge` | `3e610d0326e8c8e3faeb730323879b7656378568`, then ported Bhavya Odysee bridge baseline |
| `odysee-frontend/` | `https://github.com/OdyseeTeam/odysee-frontend.git` | `hyperbeam-implementation-rave` | `a70d7eb8fd1ac836e3f0f3a4bf9e81813dfbbd76` |
| `references/hyperbeam-bhavya/` | `https://github.com/permaweb/HyperBEAM.git` | `bhavyagor/odysee-bridge-devices` | `0cab8d2839f71a7840c7b3fdfd1905d398aac383` |
| `references/hyperbeam-rave/` | `https://github.com/NewEstablishment/HyperBEAM.git` | `odysee-on-hb-rave` | `43e0f6119e6ca2c15eea228308743ad807857524` |

## Update Policy

`hyperbeam/` should keep upstream `permaweb/HyperBEAM` `edge` alignment deliberate, but it is no longer a pure snapshot. It contains the selected Bhavya Odysee bridge/device port plus local compatibility fixes found during validation.

`odysee-frontend/` should track the agreed Odysee HyperBEAM integration branch until that work is merged or replaced.

The `references/` trees are historical comparison snapshots. Do not land new product work there. If a reference branch changes and the team wants to refresh the comparison, update the snapshot and update this file plus `aidocs/hyperbeam-approach-comparison.md` in the same change.

## Development Rule

New shared work should happen in the live source paths, not the reference paths:

- HyperBEAM base changes: `hyperbeam/`
- Odysee frontend changes: `odysee-frontend/`
- Odysee bridge/device implementation: `hyperbeam/`, with `references/hyperbeam-bhavya/` and `references/hyperbeam-rave/` used only for comparison
- Planning, setup notes, and comparison records: `aidocs/`
