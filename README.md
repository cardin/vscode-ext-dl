NodeJS Script for downloading [Visual Studio Code extensions](https://marketplace.visualstudio.com/vscode).

Use Cases

- Downloads the extensions as `.vsix` files
- Allow an offline VSCode instance to install extensions offline
- Download the extensions for an arbitrary target platform

![](https://user-images.githubusercontent.com/553816/162244430-0977eeda-df8d-4de8-b6db-70ef24d5ba2f.png)

Limitations:

- Only the latest extension version can be downloaded
- The latest version might be a pre-release version
- Requires to download a Chromium browser binary

# How it works

This script uses a headless Chromium browser & NodeJS to download the extensions. A `.txt` newline-delimited list of extension ids must be supplied.

# How to use

## Installation

1. Download & Install [NodeJS](https://nodejs.org/en/). Version 16 or above is good.
2. Git Clone the repository, or download a `.zip` package from the [Releases](https://github.com/cardin/vscode-ext-dl/releases) page.
3. Enter the repository which you'd cloned/unzipped, and install this project's NPM packages via `npm install`.

## Configuration

Prepare a newline-limited file of extension ids. If VSCode is in your `$PATH` you can run the following command to export a list of extensions:

```sh
$ code --list-extensions > extensions.txt
```

The following command runs the script and downloads it to the `~/Downloads/vscode-ext/`'s directory:

```sh
$ node src/index.js -i extensions.txt
```

![](https://user-images.githubusercontent.com/553816/162244418-b890e9d8-f788-4f15-8980-2bd1e039ed33.png)

The following options are available:

```txt
Required:
  -i, --input  A newline-delimited list of extension ids to download. You can run VSCode CLI to generate this: `code --list-extensions > extensions.txt                                        [string] [required]

Options:
  -o, --output    Destination folder
                            [default: "C:\Users\me\Downloads\vscode-ext"]
  -t, --timeout   Download-timeout (seconds) per extension
                                                    [number] [default: 180]
  -p, --platform  List of platforms to download - the rest are ignored
  [array] [choices: "win32-x64", "win32-ia32", "win32-arm64", "linux-x64", "linux-arm64", "linux-armhf", "darwin-x64", "darwin-arm64", "alpine-x64",  "web", "alpine-arm64"] [default: ["win32-x64"]]
  -d, --debug     Uses non-headless mode to perform the download
                                                [boolean] [default: false]
  -h, --help      Show help                     [boolean]
```
