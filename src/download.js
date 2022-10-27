import assert from "node:assert";
import path from "node:path";

/** @typedef {import("cli-progress").MultiBar} MultiBar */
/** @typedef {import("cli-progress").SingleBar} SingleBar */
/** @typedef {import("playwright").Page} Page */
/** @typedef {import("playwright").Download} Download */
/** @typedef {import("playwright").Locator} Locator */
/** @typedef {import("./index.js").CmdArgs} CmdArgs */
/** @typedef {import("./index.js").Extension} Extension */

const PLATFORM_CAP_SELECTOR = "div.capabilities-list-item";
const DL_BTN_SELECTOR = "[aria-label='Download Extension']";
const DL_CHV_SELECTOR = "i[data-icon-name='ChevronDown']";
const DL_PLATFORM_SELECTOR = "i[data-icon-name='Download']";
const DL_PLATFORM_NAME_SELECTOR = "i[data-icon-name='Download']+span";

/**
 * @param {MultiBar} progressMultibar
 * @param {Page} page PlayWright page object
 * @param {Extension} ext Extension to download
 * @param {CmdArgs} options
 */
export default async function dlExt(progressMultibar, page, ext, options) {
  // Move to the page
  await _navigateTo(page, ext);

  if (await _hasMultiplePlatforms(page)) {
    return MultiPlatform.init(progressMultibar, page, ext, options).then((x) =>
      x?.run()
    );
  } else {
    return SinglePlatform.run(page, options, ext);
  }
}

/**
 * Navigate to the given page
 *
 * @param {Page} page PlayWright page object
 * @param {Extension} ext Extension's URL
 * @param {number} [timeoutMs] How long to wait (milliseconds)
 */
async function _navigateTo(page, ext, timeoutMs = undefined) {
  await page.goto(ext.url.href, {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(DL_BTN_SELECTOR, { timeout: timeoutMs });
}

/**
 * Checks if there's Platform Specific builds available.
 *
 * @param {Page} page PlayWright page object
 */
async function _hasMultiplePlatforms(page) {
  return page
    .locator(DL_CHV_SELECTOR)
    .count()
    .then((x) => x == 1);
}

/**
 * Checks if the extension page has the platforms we want
 *
 * @param {Page} page PlayWright page object
 * @param {string[]} platforms E.g. "win32-x64", "linux-x64"
 * @param {boolean} matchAll For our desired platforms, must we have ALL the
 *   platforms, or ANY matched platform?
 */
async function _hasSpecifiedPlatforms(page, platforms, matchAll) {
  const availablePlatforms = await page
    .locator(PLATFORM_CAP_SELECTOR)
    .textContent()
    .then((x) => x?.toLocaleLowerCase());

  if (availablePlatforms == undefined) {
    return false;
  } else if (availablePlatforms.includes("universal")) {
    return true;
  } else if (matchAll) {
    return platforms.every((platform) => availablePlatforms.includes(platform));
  } else {
    return platforms.some((platform) => availablePlatforms.includes(platform));
  }
}

/**
 * Clicks the "selector"-specified download button and start downloading
 *
 * @param {String} dlName A friendly name
 * @param {Page} page PlayWright page object
 * @param {number} timeout How long to wait for the download
 * @param {string | Locator} selector Selector of the download button
 * @param {string} outputDir Directory to save it to
 */
async function _clickAndDl(dlName, page, timeout, selector, outputDir) {
  const locator =
    typeof selector === "string" || selector instanceof String
      ? page.locator(selector.toString())
      : selector;

  const downloadResp = await Promise.all([
    // Start waiting for the page to finish loading
    page.waitForEvent("download"),
    // Perform the action that initiates download
    locator.click({ timeout: timeout }),
  ])
    .then((x) => x[0])
    .catch((err) => {
      console.error(`Failed on downloading ${dlName}`);
      throw err;
    });

  // Wait for the download process to complete
  const savePath = path.join(outputDir, downloadResp.suggestedFilename());
  await downloadResp.saveAs(savePath);
  await downloadResp.delete();
}

class SinglePlatform {
  /**
   * Downloads the extension when there's only 1 platform available.
   *
   * @param {Page} page PlayWright page object
   * @param {CmdArgs} options
   * @param {Extension} ext Extension to download
   */
  static async run(page, options, ext) {
    if (!(await _hasSpecifiedPlatforms(page, options.platform, true))) {
      console.warn(
        `\nSkipping ${ext.id} as it does not have the desired platform[s]\n`
      );
      return;
    }
    return _clickAndDl(
      "-",
      page,
      options.timeout,
      DL_BTN_SELECTOR,
      options.output
    );
  }
}

class MultiPlatform {
  /** @type {PlatformTask[]} */
  #platformTaskList;
  /** @type {SingleBar} */
  #progressBar;

  /**
   * @param {MultiBar} progressMultibar
   * @param {Page} page PlayWright page object
   * @param {Extension} ext Extension to download
   * @param {CmdArgs} options
   */
  constructor(progressMultibar, page, ext, options) {
    this._progressMultibar = progressMultibar;
    this._page = page;
    this._ext = ext;
    this._options = options;
  }

  /**
   * @param {MultiBar} progressMultibar
   * @param {Page} page PlayWright page object
   * @param {Extension} ext Extension to download
   * @param {CmdArgs} options
   */
  static async init(progressMultibar, page, ext, options) {
    // Check if our target platforms exist
    if (!(await _hasSpecifiedPlatforms(page, options.platform, false))) {
      console.warn(
        `Skipping ${ext.id} as it does not have the desired platform[s]`
      );
      return;
    }

    const mPlatform = new MultiPlatform(progressMultibar, page, ext, options);

    // Init
    mPlatform.#platformTaskList = await mPlatform.#computePlatformTaskList();
    mPlatform.#progressBar = mPlatform._progressMultibar.create(
      mPlatform.#platformTaskList.length,
      0
    );
    return mPlatform;
  }

  /**
   * Determine which platforms we should download, and where those selectors are
   * located
   */
  async #computePlatformTaskList() {
    /** @type {PlatformTask[]} */
    const platformTaskList = [];
    const whitelistPlatforms = this._options.platform;

    // Get the dropdown list and its Platform entries
    await this.#ensureDropdownExists();
    const allPlatformNameSelectors = this._page.locator(
      DL_PLATFORM_NAME_SELECTOR
    );
    const allSelectorsCount = await allPlatformNameSelectors.count();

    // Filter the entries
    for (let i = 0; i < allSelectorsCount; ++i) {
      const platformName = (
        await allPlatformNameSelectors.nth(i).textContent()
      )?.toLowerCase();

      if (
        platformName != undefined &&
        whitelistPlatforms.includes(platformName)
      ) {
        platformTaskList.push(new PlatformTask(i, platformName));
      }
    }
    return platformTaskList;
  }

  /** Downloads all the Platforms available on this page. */
  async run() {
    for (const task of this.#platformTaskList) {
      this.#progressBar.update({
        type: "platforms",
        dlName: task.extName,
      });

      // Get the dropdown list to click on each entry
      await this.#ensureDropdownExists();
      const allPlatformBtns = this._page.locator(DL_PLATFORM_SELECTOR);
      const btn = allPlatformBtns.nth(task.selectorIdx);

      await _clickAndDl(
        task.extName,
        this._page,
        this._options.timeout,
        btn,
        this._options.output
      );
      this.#progressBar.increment({
        type: "platforms",
        dlName: task.extName,
      });
    }
    this.#progressBar.stop();
    this._progressMultibar.remove(this.#progressBar);
  }

  /** Ensures the Platform Dropdown List exists. */
  async #ensureDropdownExists() {
    if (!(await this.#isDropdownExists())) {
      // If doesn't exist, then click on the button to open the dropdown list
      await this._page
        .locator(DL_BTN_SELECTOR)
        .click()
        .then(() => this._page.waitForSelector(DL_PLATFORM_SELECTOR));

      assert(await this.#isDropdownExists());
    }
  }

  /**
   * Checks if the dropdown list exists
   *
   * @param {number} [timeoutMs] How long to wait (milliseconds)
   */
  async #isDropdownExists(timeoutMs = 10000) {
    return this._page
      .waitForSelector(DL_PLATFORM_SELECTOR, { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }
}

class PlatformTask {
  /**
   * @property {number} selectorIdx The numbered entry/index where the platform
   *   entry resides
   * @property {string} extName Name of the extension
   */
  constructor(selectorIdx, extName) {
    this.selectorIdx = selectorIdx;
    this.extName = extName;
  }
}
