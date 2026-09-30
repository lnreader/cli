"use strict";
// Shaped like upstream's compiled output: CommonJS, `exports.default = new Plugin()`.
var __importDefault = (this && this.__importDefault) || function (mod) {
  return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var fetch_1 = require("@libs/fetch");
var cheerio_1 = require("cheerio");
var novelStatus_1 = require("@libs/novelStatus");
var storage_1 = require("@libs/storage");
var filterInputs_1 = require("@libs/filterInputs");
var dayjs_1 = __importDefault(require("dayjs"));
var FixturePlugin = (function () {
  function FixturePlugin() {
    this.id = "fixture";
    this.name = "Fixture";
    this.version = "1.0.0";
    this.icon = "src/en/fixture/icon.png";
    this.site = "https://novels.test/";
    this.imageRequestInit = { headers: { "X-Image-Token": "abc" } };
    this.pluginSettings = {
      apiKey: { value: "", label: "API key", type: "Text" },
      nsfw: { value: false, label: "Show NSFW", type: "Switch" },
    };
    this.loads = (storage_1.storage.get("loads") || 0) + 1;
    storage_1.storage.set("loads", this.loads);
    this.filters = {
      order: {
        type: filterInputs_1.FilterTypes.Picker,
        label: "Order",
        value: "popular",
        options: [{ label: "Popular", value: "popular" }, { label: "Newest", value: "new" }],
      },
    };
  }
  FixturePlugin.prototype.popularNovels = async function (page, options) {
    var order = options.filters ? options.filters.order.value : "none";
    var kind = options.showLatestNovels ? "Latest" : "Popular";
    return [{ name: kind + " " + order + " " + page, path: "novel/abc" }];
  };
  FixturePlugin.prototype.searchNovels = async function (term, page) {
    var html = await (0, fetch_1.fetchText)(this.site + "search?q=" + encodeURIComponent(term) + "&page=" + page);
    var $ = (0, cheerio_1.load)(html);
    return $(".result a").map(function (_, el) {
      return { name: $(el).text(), path: $(el).attr("href").replace(/^\//, ""), cover: $(el).attr("data-cover") };
    }).get();
  };
  FixturePlugin.prototype.parseNovel = async function (novelPath) {
    var res = await (0, fetch_1.fetchApi)(this.site + novelPath);
    var $ = (0, cheerio_1.load)(await res.text());
    return {
      path: novelPath,
      name: $("h1").text(),
      author: $(".author").text(),
      cover: $(".cover").attr("src"),
      genres: $(".genre").map(function (_, el) { return $(el).text(); }).get().join(","),
      summary: $(".summary").text(),
      status: novelStatus_1.NovelStatus.Ongoing,
      chapters: $(".chapters a").map(function (i, el) {
        return {
          name: $(el).text(),
          path: $(el).attr("href").replace(/^\//, ""),
          releaseTime: (0, dayjs_1.default)("2024-01-0" + (i + 1)).toISOString(),
        };
      }).get(),
    };
  };
  FixturePlugin.prototype.parseChapter = async function (chapterPath) {
    var res = await fetch(this.site + chapterPath); // global fetch, as a few upstream plugins do
    var $ = (0, cheerio_1.load)(await res.text());
    return $("#content").html() || "";
  };
  FixturePlugin.prototype.probe = function () {
    return {
      process: typeof process,
      require: typeof require,
      buffer: typeof Buffer,
    };
  };
  return FixturePlugin;
})();
exports.default = new FixturePlugin();
