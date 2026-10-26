# Security

## Reporting a vulnerability

Report it privately through [GitHub's private vulnerability reporting](https://github.com/rozenodig/Diktatorn/security/advisories/new), not in a public issue. Include the Diktatorn version, your macOS version and the steps to reproduce it.

## Supported versions

Only the latest release gets security fixes. Diktatorn never checks for updates, so to hear about new releases, watch the repository on GitHub (Watch → Custom → Releases).

## How Diktatorn is protected

- **Windows.** Each window shows one page bundled with the app, sandboxed and with a content security policy. It can't navigate elsewhere or open other windows. The main process checks every message against the window that sent it. Only the hidden capture window may use the microphone.
- **The packaged app.** Electron's fuses are set so the app can't run as plain Node.js or be inspected, and it loads only its own integrity-checked archive. It refuses command-line arguments, such as a remote-debugging port.
- **Models.** Each model is pinned to a Hugging Face commit. A download is checked against its exact size and SHA-256 before it is used.
- **Inserted text.** Control characters are removed before pasting. In a terminal, newlines and tabs become spaces too, so dictated text can't run a command.
- **Cleanup.** The language model can only delete words from the transcript, and every deletion must be a filler or a self-correction. Any other answer is rejected, so dictated text can't make it write something new.

## Known limitations

- **Code already running as you.** Diktatorn's certificate has no Apple Team ID, so the app turns off macOS library validation; otherwise it couldn't load its own frameworks. Code already running under your account could therefore change the installed app and use its Microphone and Accessibility permissions. It could also swap a model file for another of the same size, because at startup models are checked by size only; the SHA-256 is checked when they are downloaded. Only an Apple Developer ID certificate would close this.
- **Not notarized.** Apple hasn't scanned the builds. Check the .dmg's SHA-256 and the signature as described under [Install](README.md#install). If a new version ever asks for Microphone or Accessibility again, it is signed with a different certificate: don't allow it, and report it.
- **No automatic updates.** A fix reaches you only when you install the new release.
