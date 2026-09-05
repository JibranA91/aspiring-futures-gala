/* image-slot.js — a user-fillable image placeholder custom element.
 *
 * Drop-in replacement for the design-system's <image-slot>, trimmed to what the
 * audience screen needs: the "Give from your seat" QR slot. Click to browse or
 * drag an image file onto it; the picked image is stored as a data URL in
 * localStorage under the element's id, so it survives reloads on that machine.
 *
 * Attributes:  id (persistence key, required)  ·  shape (rect|rounded|circle|pill)
 *              radius (px, for rounded)  ·  fit (cover|contain)  ·  src (fallback)
 *              placeholder (empty-state caption)
 */
(function () {
  "use strict";
  if (window.customElements && customElements.get("image-slot")) return;

  var PREFIX = "af-imgslot:";

  function radiusFor(shape, radius) {
    if (shape === "circle") return "50%";
    if (shape === "pill") return "999px";
    if (shape === "rect") return "0";
    return (radius || 12) + "px"; // rounded (default)
  }

  class ImageSlot extends HTMLElement {
    static get observedAttributes() { return ["shape", "radius", "fit", "src", "placeholder"]; }

    connectedCallback() {
      if (this.__built) { this.render(); return; }
      this.__built = true;
      this.__stored = this.readStored();

      this.style.display = this.style.display || "inline-flex";
      this.style.position = "relative";
      this.style.overflow = "hidden";
      this.style.cursor = "pointer";
      this.style.boxSizing = "border-box";
      this.style.userSelect = "none";

      this.__img = document.createElement("img");
      this.__img.setAttribute("alt", "");
      this.__img.style.cssText = "width:100%;height:100%;display:block";
      this.__cap = document.createElement("div");
      this.__cap.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
        "text-align:center;padding:10px;box-sizing:border-box;font-size:13px;line-height:1.3;" +
        "font-family:var(--font-body,system-ui,sans-serif);" +
        "color:color-mix(in srgb, currentColor 60%, transparent);" +
        "border:1.5px dashed color-mix(in srgb, currentColor 35%, transparent)";
      this.appendChild(this.__img);
      this.appendChild(this.__cap);

      this.__file = document.createElement("input");
      this.__file.type = "file";
      this.__file.accept = "image/*";
      this.__file.style.display = "none";
      this.appendChild(this.__file);

      var self = this;
      this.addEventListener("click", function (e) { if (e.target !== self.__file) self.__file.click(); });
      this.__file.addEventListener("change", function () {
        var f = self.__file.files && self.__file.files[0];
        if (f) self.ingest(f);
        self.__file.value = "";
      });
      this.addEventListener("dragover", function (e) { e.preventDefault(); self.style.outline = "2px solid var(--color-accent, #f2a93b)"; });
      this.addEventListener("dragleave", function () { self.style.outline = "none"; });
      this.addEventListener("drop", function (e) {
        e.preventDefault(); self.style.outline = "none";
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) self.ingest(f);
      });

      this.render();
    }

    attributeChangedCallback() { if (this.__built) this.render(); }

    key() { return PREFIX + (this.getAttribute("id") || "default"); }
    readStored() { try { return localStorage.getItem(this.key()) || ""; } catch (e) { return ""; } }

    ingest(file) {
      if (!/^image\//.test(file.type)) return;
      var self = this;
      var r = new FileReader();
      r.onload = function () {
        self.__stored = String(r.result || "");
        try { localStorage.setItem(self.key(), self.__stored); } catch (e) {}
        self.render();
      };
      r.readAsDataURL(file);
    }

    render() {
      var shape = this.getAttribute("shape") || "rounded";
      var rad = radiusFor(shape, this.getAttribute("radius"));
      this.style.borderRadius = rad;
      this.__cap.style.borderRadius = rad;
      var fit = this.getAttribute("fit") === "contain" ? "contain" : "cover";
      var src = this.__stored || this.getAttribute("src") || "";
      this.__img.style.objectFit = fit;
      if (src) {
        this.__img.src = src;
        this.__img.style.display = "block";
        this.__cap.style.display = "none";
      } else {
        this.__img.removeAttribute("src");
        this.__img.style.display = "none";
        this.__cap.style.display = "flex";
        this.__cap.textContent = this.getAttribute("placeholder") || "Drop an image";
      }
    }
  }

  customElements.define("image-slot", ImageSlot);
})();
