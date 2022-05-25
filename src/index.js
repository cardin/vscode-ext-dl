import cliProgress from "cli-progress";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { setTimeout } from "node:timers/promises";
import { chromium as browserExe } from "playwright";
import yargs from "yargs";
import download from "./download.js";
import PLATFORMS from "./platforms.js";

/**
 * @typedef {Object} CmdArgs
 * @property {string} input
 * @property {string} output
 * @property {number} timeout
 * @property {string[]} platform
 * @property {boolean} debug
 */

/**
 * @typedef {Object} Extension
 * @property {string} id
 * @property {URL} url
 */

(async () => {
  const argv = await _parseCmdArgs();

  const extList = _loadExtList(argv.input);
  await _chkOutputDir(argv.output);
  await _setupBrowserAndBegin(extList, argv);
})();

/** @returns {Promise<CmdArgs>} */
async function _parseCmdArgs() {
  const argv = await yargs(process.argv)
    .option("input", {
      alias: "i",
      string: true,
      demandOption: true,
      requiresArg: true,
      group: "Required:",
      describe:
        "A newline-delimited list of extension ids to download. " +
        "You can run VSCode CLI to generate this: `code --list-extensions > extensions.txt",
    })
    .option("output", {
      alias: "o",
      default: path.join(os.homedir(), "Downloads", "vscode-ext"),
      describe: "Destination folder",
    })
    .option("timeout", {
      alias: "t",
      number: true,
      default: 3 * 60,
      describe: "Download-timeout (seconds) per extension",
      coerce: (val) => val * 1000,
    })
    .option("platform", {
      alias: "p",
      string: true,
      array: true,
      choices: Object.keys(PLATFORMS),
      default: [`${os.platform()}-${os.arch()}`],
      describe: "List of platforms to download - the rest are ignored",
    })
    .option("debug", {
      alias: "d",
      boolean: true,
      default: false,
      describe: "Uses non-headless mode to perform the download",
    })
    .hide("version")
    .alias(["h"], "help").argv;

  argv.platform = argv.platform.map((x) => PLATFORMS[x].toLocaleLowerCase());
  return argv;
}

/**
 * URL of the extension
 *
 * @param {string} extId
 */
function _getVsCodeUrl(extId) {
  return new URL(
    `https://marketplace.visualstudio.com/items?itemName=${extId}`
  );
}

/**
 * Loads the extension list and gets the URL of each extension
 *
 * @param {string} inputPath Location of the newline-delimited list of extension ids
 * @throws {Error} If "inputPath" doesn't exist
 */
function _loadExtList(inputPath) {
  assert(fs.existsSync(inputPath));
  const listRaw = fs.readFileSync(inputPath, { encoding: "utf-8" }).split("\n");
  return listRaw
    .filter((x) => x)
    .map((x) => x.trim())
    .filter((x) => x)
    .map((x) => {
      return { id: x, url: _getVsCodeUrl(x) };
    });
}

/**
 * Checks the output directory.
 *
 * If it exists, prompt for overwrite. If it doesn't exist, create it.
 *
 * @param {string} outputPath The output directory
 */
async function _chkOutputDir(outputPath) {
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await new Promise((res) =>
      rl.question(
        "Output folder already exists. Overwrite it? ([y]|n) ",
        (ans) => {
          switch (ans.toLocaleLowerCase()) {
            case "y":
            case "":
              res();
              break;
            case "n":
              console.log("Exit");
              process.exit(0);
            default:
              console.error("Invalid input given");
              process.exit(1);
          }
        }
      )
    );
  }
}

/**
 * @param {Extension[]} extensions List of Extensions
 * @param {CmdArgs} options
 */
async function _setupBrowserAndBegin(extensions, options) {
  // Browser
  const browser = await browserExe.launch(
    options.debug ? { headless: false, slowMo: 1000 } : undefined
  );
  const page = await browser.newPage();

  // Progress Bar
  const progressMultiBar = new cliProgress.MultiBar({
    format:
      "|{bar}| {value}/{total} {type} || Elapsed {duration_formatted} || ETA ~{eta_formatted} || {dlName}",
    hideCursor: true,
  });
  const progressBar = progressMultiBar.create(extensions.length, 0);

  // Extension Page
  for (let ext of extensions) {
    progressBar.update({ type: "extensions", dlName: ext.id });
    await download(progressMultiBar, page, ext, options).catch((err) => {
      console.error(`\nError on ${ext.id}`);
      throw err;
    });
    progressBar.increment({ type: "extensions", dlName: ext.id });
  }
  progressBar.stop();

  // End
  await browser.close();
  await setTimeout(1000);
  console.info("\nAll done!");
  process.exit();
}
