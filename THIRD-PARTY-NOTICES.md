# Third-party notices

Claude TV itself is MIT licensed, see [LICENSE](LICENSE). The packaged
application ships the following third-party components.

## Electron

Copyright (c) Electron contributors, copyright (c) 2013-2020 GitHub Inc.
Licensed under the MIT License. Electron bundles Chromium and Node.js; their
licenses are included in the packaged app as `LICENSE.electron.txt` and
`LICENSES.chromium.html` next to the executable.

<https://github.com/electron/electron>

## Fraunces

Copyright 2020 The Fraunces Project Authors
(<https://github.com/undercasetype/Fraunces>). Licensed under the SIL Open
Font License, Version 1.1. The full text ships with the app as
`vendor/fonts/Fraunces-OFL.txt`.

## Instrument Sans

Copyright 2022 The Instrument Sans Project Authors
(<https://github.com/Instrument/instrument-sans>). Licensed under the SIL Open
Font License, Version 1.1. The full text ships with the app as
`vendor/fonts/InstrumentSans-OFL.txt`.

## The mascot

The pixel figure is a redrawing of Clawd, the character Anthropic uses for
Claude Code. The pixel maps in `renderer/character.js` were drawn for this
project and are covered by the MIT license above; the character itself is not
ours. Claude TV is an independent tool and is neither affiliated with nor
endorsed by Anthropic. "Claude" and "Anthropic" are trademarks of Anthropic
PBC.

## Build-time only

`electron-builder` (MIT) produces the installer. It is a development
dependency and is not part of the shipped application.
