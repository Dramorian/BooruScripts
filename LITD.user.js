// ==UserScript==
// @name         Danbooru - Look Into The Deep AI (LITD)
// @namespace    LITD
// @version      1.0
// @description  Sends image to autotagger.aibooru and returns the list of suggested tags
// @match        https://danbooru.donmai.us/uploads/*
// @match        https://danbooru.donmai.us/posts/*
// @match        https://aibooru.online/uploads/*
// @match        https://aibooru.online/posts/*
// @connect      autotagger.aibooru.online
// @connect      cdn.aibooru.download
// @connect      cdn.donmai.us
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @run-at       document-end
// ==/UserScript==

/* global Danbooru $ */

(() => {
  const CONFIG = {
    AUTO_TAGGER_URL: 'https://autotagger.aibooru.online/evaluate',
    TAG_THRESHOLD: 0.01,
    TAG_LIMIT: 100,
    CACHE_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000 // 7 days
  };

  // Cache utilities
  const cache = {
    key: url => `litd_cache_${url.replace(/[^a-zA-Z0-9]/g, '_')}`,

    async get(key) {
      const cached = await GM.getValue(key, null);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CONFIG.CACHE_EXPIRY_MS) return data;
        GM.setValue(key, null);
      }
      return null;
    },

    set: (key, data) => GM.setValue(key, JSON.stringify({ timestamp: Date.now(), data }))
  };

  // Utility functions
  const utils = {
    extractImageUrl: img => {
      if (!img) return null;
      const url = new URL(img.src);
      return url.pathname === "/uploads/image_proxy" ? url.searchParams.get("url") : img.src;
    },

    isVideo: el => el?.tagName === 'VIDEO',

    fetchBlob: url => new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        onload: resolve,
        onerror: reject
      });
    }),

    async getVideoFrame() {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (!ogImg?.content) throw new Error("No og:image found");
      const response = await fetch(ogImg.content);
      return response.blob();
    },

    createFormData: (blob, fileName) => {
      const fd = new FormData();
      fd.append("file", blob, fileName);
      fd.append("format", "html");
      fd.append("threshold", CONFIG.TAG_THRESHOLD);
      fd.append("limit", CONFIG.TAG_LIMIT);
      return fd;
    }
  };

  // Tag processing
  const tags = {
    getCurrent: () => {
      const textarea = document.querySelector("#post_tag_string");
      return textarea ? textarea.value.trim().split(/\s+/).filter(Boolean) : [];
    },

    processSuggested: (doc, currentTags) => {
      const rows = Array.from(doc.querySelectorAll("tbody tr"));
      const tagsHtml = rows.map(row => {
        const link = row.querySelector("a.text-sky-600.hover\\:text-sky-500.mr-4");
        const conf = row.querySelector("td.text-gray-400.text-right");

        if (!link || !conf) return "";

        const tagName = link.textContent.replace(/\s+/g, '_').trim();
        const confidence = conf.textContent.trim();
        const checked = currentTags.includes(tagName) ? 'checked' : '';

        return `<li class="flex items-center gap-1 w-fit leading-none">
          <input type="checkbox" tabindex="-1" ${checked}>
          <span class="related-tag">
            <a class="tag-type-0" data-tag-name="${tagName}" href="/posts?tags=${encodeURIComponent(tagName)}">${tagName} <span class="text-muted text-xs">${confidence}</span></a>
          </span>
        </li>`;
      }).join("");

      return `<div class="tag-column card p-2 h-fit space-y-1">
        <h3>Suggested Tags</h3>
        <ul class="tag-list">${tagsHtml}</ul>
      </div>`;
    }
  };

  // Main app
  const app = {
    init() {
      if (this.isUploadsPage()) {
        setTimeout(() => this.processMedia(), 500);
      } else {
        this.setupEditListener();
      }
    },

    isUploadsPage() {
      const isUpload = /uploads\/\d+/.test(location.href);
      const hasMedia = document.querySelector(".media-asset-image") || document.querySelector("video.media-asset-image");
      return isUpload && hasMedia;
    },

    setupEditListener() {
      const editLink = document.getElementById("post-edit-link");
      if (editLink) {
        editLink.onclick = () => {
          const exists = Array.from(document.querySelectorAll('.tag-column.card h3'))
            .some(h => h.textContent === "Suggested Tags");
          if (!exists) this.processMedia();
        };
      }
    },

    showProgress() {
      this.hideProgress();
      const progress = document.createElement('div');
      progress.id = 'litd-progress';
      progress.className = 'tag-column card p-2 h-fit';
      progress.innerHTML = '<h3>Tag Processing</h3><div>Analyzing media...</div>';
      document.querySelector('.related-tags')?.appendChild(progress);
    },

    hideProgress() {
      document.getElementById('litd-progress')?.remove();
    },

    async processMedia() {
      const media = document.querySelector("#image, .media-asset-image, video.media-asset-image");
      if (!media) return;

      this.showProgress();

      try {
        let blob, fileName, cacheKey;

        if (utils.isVideo(media)) {
          blob = await utils.getVideoFrame();
          fileName = "video_frame.jpg";
          const ogImg = document.querySelector('meta[property="og:image"]');
          cacheKey = cache.key(ogImg.content);
        } else {
          const url = utils.extractImageUrl(media);
          if (!url) return this.hideProgress();

          cacheKey = cache.key(url);
          const response = await utils.fetchBlob(url);
          blob = new Blob([response.response], { type: response.response.type || "image/jpeg" });
          fileName = url.split("/").pop().split("?")[0] || "image.jpg";
        }

        // Check cache
        const cached = await cache.get(cacheKey);
        if (cached) {
          console.log("LITD: Using cached response");
          return this.handleResponse({ responseText: cached });
        }

        // Send for tagging
        this.sendForTagging(blob, fileName, cacheKey);
      } catch (error) {
        console.error("LITD: Error processing media:", error);
        this.hideProgress();
      }
    },

    sendForTagging(blob, fileName, cacheKey) {
      GM.xmlHttpRequest({
        method: "POST",
        url: CONFIG.AUTO_TAGGER_URL,
        data: utils.createFormData(blob, fileName),
        onload: async response => {
          await cache.set(cacheKey, response.responseText);
          this.handleResponse(response);
        },
        onerror: error => {
          this.hideProgress();
          console.error("LITD: Tagging error:", error);
        }
      });
    },

    handleResponse(response) {
      this.hideProgress();

      const doc = new DOMParser().parseFromString(response.responseText, "text/html");
      const currentTags = tags.getCurrent();
      const html = tags.processSuggested(doc, currentTags);

      const container = document.querySelector(".related-tags");
      if (container) {
        container.insertAdjacentHTML('beforeend', html);
        if (typeof Danbooru !== 'undefined' && Danbooru.RelatedTag) {
          Danbooru.RelatedTag.update_selected();
        }
      }
    }
  };

  // Initialize
  app.init();
})();
