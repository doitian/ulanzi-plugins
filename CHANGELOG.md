# Changelog

Notable changes are recorded here, newest first. Each section is generated from
the commit history by [git-cliff](https://git-cliff.org) when a version tag is
pushed.

## 1.0.2 - 2026-10-17 ([Full Changelog](https://github.com/doitian/ulanzi-plugins/compare/v1.0.1...v1.0.2))

### Fixes

- reconnect the host socket instead of exiting on close ([de3298e](https://github.com/doitian/ulanzi-plugins/commit/de3298e8ced4d45fd1e6e3e16b71f437b0159ad1))

### Miscellaneous

- bump the plugin to 1.0.2 ([0392244](https://github.com/doitian/ulanzi-plugins/commit/039224465374854c51c9278282aeb9ec0a2da6f1))

## 1.0.1 - 2026-10-16 ([Full Changelog](https://github.com/doitian/ulanzi-plugins/compare/v1.0.0...v1.0.1))

### Features

- add repo readme covering widgets, install, development, and releases ([add1314](https://github.com/doitian/ulanzi-plugins/commit/add1314f7dddbfdf0ad50f717ffae4da1bdb2eaf))

### Fixes

- fix changelog section separation when a compare link is present ([da15705](https://github.com/doitian/ulanzi-plugins/commit/da15705c618a32c889a7646c750fd6af053b58bf))

### Miscellaneous

- keep an auto generated changelog for each release ([c683394](https://github.com/doitian/ulanzi-plugins/commit/c683394e318bd4f2265fad62d1ce84a3c71426aa))
- avoid the github api when generating changelog links ([b212957](https://github.com/doitian/ulanzi-plugins/commit/b212957922bf731f9a7580f57fdc2f7046646d8d))
- bump the plugin to 1.0.1 ([764bb6e](https://github.com/doitian/ulanzi-plugins/commit/764bb6efdc3bf0504894c5f6405e4b260dac80d9))

## 1.0.0 - 2026-10-16

### Changes

- rename press action settings to URL-only ([ebf1cf2](https://github.com/doitian/ulanzi-plugins/commit/ebf1cf257f841db1d85dc513e3665da66c3cc2ed))
- update ulanzi figma icons skill with file key and rendering guidance ([036c8bd](https://github.com/doitian/ulanzi-plugins/commit/036c8bd25f750632c8e1baecda660c874521d658))
- update develop-ulanzi-plugin skill for the widget-collection architecture ([e7ef6a6](https://github.com/doitian/ulanzi-plugins/commit/e7ef6a6023105d2ddf322580ef074f6e775b1f18))
- update install-ulanzi-plugin skill for the script-based install flow ([237c4ef](https://github.com/doitian/ulanzi-plugins/commit/237c4efa637263249fdae9302261553a1c109c59))
- update ulanzi-figma-icons to the duplicated figma file ([5df4b1b](https://github.com/doitian/ulanzi-plugins/commit/5df4b1b70cb874e1d8bc1ac48559416ccddf2f2d))
- update soundswitch widgets to alias devices globally ([75a9bf6](https://github.com/doitian/ulanzi-plugins/commit/75a9bf6d2024d95505ca1cf076f14e6640016216))
- update ai usage to read opencode v2 credential stores ([3bf1d21](https://github.com/doitian/ulanzi-plugins/commit/3bf1d2165681590e79994e69165bd3301ad597da))

### Documentation

- document the multi-grid layout and bound spacer in ulanzi-figma-icons ([354b20b](https://github.com/doitian/ulanzi-plugins/commit/354b20b25481a4e23740fb599d25e33daadac0f8))

### Features

- add skill to install ulanzi plugins via mise ([1b3368a](https://github.com/doitian/ulanzi-plugins/commit/1b3368a2c1c4fa6a45340aa3f4f134553af5eda7))
- add ai usage widgets with a shared plugin service ([0a26b25](https://github.com/doitian/ulanzi-plugins/commit/0a26b258109429eccbb02c7a8b8ef12be73bccf4))
- add xAI (Grok) weekly usage to the AI usage widget ([061bb7c](https://github.com/doitian/ulanzi-plugins/commit/061bb7c9250a3d63e3557d5d500a84c8a0c12633))
- add configured ai usage instances api ([3e98cdc](https://github.com/doitian/ulanzi-plugins/commit/3e98cdc2563ce5e29cb76fbed88e80216efcb5f8))
- add ai usage refresh endpoint and rename fetch route ([4b41531](https://github.com/doitian/ulanzi-plugins/commit/4b4153186bd7efae0e2d86af0ba3d1aa0636a8ff))
- add Kimi Code usage to the AI usage widget ([9064cc4](https://github.com/doitian/ulanzi-plugins/commit/9064cc42ea128d3d36fb18320cd1e3260705cb33))
- add optional usage and reset gauges to day-based AI usage windows ([81473a3](https://github.com/doitian/ulanzi-plugins/commit/81473a385d620e11204e8da52350a24ee3b0a78c))
- add .claude/skills to gitignore ([5020724](https://github.com/doitian/ulanzi-plugins/commit/502072411f5f6f64bd16e16a1c367fdcff0f493a))
- add an agent status widget backed by agent-berth ([2364451](https://github.com/doitian/ulanzi-plugins/commit/2364451769aa8f187504511d2ccd3d3970a5f007))
- add sound control widgets driven by the SoundSwitch CLI ([825f56e](https://github.com/doitian/ulanzi-plugins/commit/825f56eeb44fd9f29692816407da4565beaf4940))
- add aliyun savings plan balances to ai usage ([23ca359](https://github.com/doitian/ulanzi-plugins/commit/23ca3598e1231c0b0707798a2069b99e0f515bd6))
- add github actions workflow for running tests ([b35845f](https://github.com/doitian/ulanzi-plugins/commit/b35845f91066764e0f67dd4da043ba66763cab59))
- add github actions workflow for releasing plugins on version tags ([74f0eaa](https://github.com/doitian/ulanzi-plugins/commit/74f0eaa8b5e8cdef9ae45bf4538b9277217da069))

### Fixes

- fix openurl identity fields for main-service widgets ([9c28165](https://github.com/doitian/ulanzi-plugins/commit/9c281657f57585eb8407a286feeb4c53ed9eb9ca))
- fix edge window focus on ai usage presses ([3a497da](https://github.com/doitian/ulanzi-plugins/commit/3a497da44414e0e8867ca027eaa21cf7baf8b614))
- avoid Node 20.12.2 web stream crash in proxied AI usage fetches ([eecd977](https://github.com/doitian/ulanzi-plugins/commit/eecd977ba8498c80b8a27cae2879a7fe7355fdef))
- survive the web stream adapter teardown error and pin CI to the Studio Node ([cbd07d6](https://github.com/doitian/ulanzi-plugins/commit/cbd07d621e7692f3615a0509feaafe1531afdbf9))

### Miscellaneous

- initial commit ([78cea2f](https://github.com/doitian/ulanzi-plugins/commit/78cea2ff5c630b07ecf56bf71a0174d888a3d26d))
- read opencode go usage with opencode console oauth ([91832ee](https://github.com/doitian/ulanzi-plugins/commit/91832eea090f4c046fc2193edb184ab725efbb49))
- show banked claude and codex limit resets on 7d ai usage keys ([4b0d186](https://github.com/doitian/ulanzi-plugins/commit/4b0d18671f265b4bb85b318f648be3ef713eacff))
- force ai usage api traffic through a shared http proxy option ([3b14599](https://github.com/doitian/ulanzi-plugins/commit/3b1459910473c786aca39dd3e770a27c921d7382))

### Refactoring

- consolidate widgets into JS plugin ([36509ff](https://github.com/doitian/ulanzi-plugins/commit/36509ff7d706aaac4d74af5373f58e56a0c43f47))
- organize skills and add ulanzi figma icon guidance ([ddf1b17](https://github.com/doitian/ulanzi-plugins/commit/ddf1b17f1cf04000554a0abc342126a7ba0fa180))

### Removals

- drop the corner pie gauge, keeping only side bars ([e133459](https://github.com/doitian/ulanzi-plugins/commit/e133459e1f89e72d96366741c4c1ce76ac694f30))
