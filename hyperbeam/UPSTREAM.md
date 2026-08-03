# HyperBEAM Upstream Provenance

The HyperBEAM runtime in this directory is vendored from the official
[`permaweb/HyperBEAM`](https://github.com/permaweb/HyperBEAM) repository.

- Upstream branch: `edge`
- Synchronized revision: `7135fdba50821979880ab21179c21536621ce807`
- Previous synchronized baseline: `3e610d0326e8c8e3faeb730323879b7656378568`
- Synchronized on: 2026-08-03

The update was applied as a three-way vendor merge so upstream runtime and
device changes are retained while the repository's Odysee/LBRY devices,
stores, codecs, configuration, and tests remain present. Every file under the
upstream revision's `src/preloaded/` tree is represented locally.

For future updates, fetch the official `edge` branch, compare from the
synchronized revision recorded above, and merge upstream changes without
adding Odysee-specific behavior to generic upstream devices. Update this file
to the new revision after the merged runtime compiles and its affected tests
pass.
