"use strict";
// The phone side of the photo handoff: pick a photo, make a smaller metadata-free JPEG copy, send it to the screen.
(() => {
  const id = (location.pathname.match(/^\/phone\/([A-Za-z0-9_-]{22})\/?$/) || [])[1] || "";
  const $ = selector => document.getElementById(selector);
  const pick = $("pick"), send = $("send"), status = $("status"), preview = $("preview"), frame = $("previewFrame"), pickLabel = $("pickLabel");
  const MAX_SIDE = 1600;
  let copy = null, previewUrl = "";

  const say = (text, kind = "") => { status.textContent = text; status.className = `status${kind ? ` is-${kind}` : ""}`; };
  function finished(title, text) {
    $("title").textContent = title; $("lede").textContent = text;
    $("actions").hidden = true; say("");
  }
  async function errorText(response) {
    try { const data = await response.json(); if (typeof data.error === "string") return data.error; } catch {}
    return "That photo couldn't be sent. Try again.";
  }

  if (!id) { finished("This link isn't complete", "Scan the QR code on the screen again."); return; }
  fetch(`/api/handoff/${id}/status`, { cache: "no-store" }).then(r => r.json()).then(data => {
    if (data.status === "gone") finished("This code has expired", "Choose “New code” on the screen and scan the new QR code.");
    if (data.status === "sent") finished("Already sent", "A photo was already sent with this code. Look at the screen.");
  }).catch(() => {});

  // Decode with the photo's own orientation, draw it smaller onto a canvas and re-encode: the copy keeps only pixels.
  async function decode(file) {
    if ("createImageBitmap" in window) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally { URL.revokeObjectURL(url); }
  }
  async function smallerCopy(file) {
    const source = await decode(file);
    const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("empty");
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .88));
    if (!blob) throw new Error("encode");
    return blob;
  }

  pick.addEventListener("change", async () => {
    const file = pick.files?.[0];
    pick.value = "";
    if (!file) return;
    send.hidden = true; copy = null;
    say("Preparing your photo…");
    try { copy = await smallerCopy(file); }
    catch { say("This photo couldn't be opened here. Try a different photo, or a screenshot of it.", "error"); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(copy);
    preview.src = previewUrl; frame.hidden = false;
    pickLabel.firstChild.textContent = "Choose a different photo";
    send.hidden = false; send.disabled = false;
    say("This is the copy that will be sent.");
  });

  send.addEventListener("click", async () => {
    if (!copy) return;
    send.disabled = true; say("Sending…");
    try {
      const response = await fetch(`/api/handoff/${id}/photo`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: copy });
      if (!response.ok) { const text = await errorText(response); say(text, "error"); send.disabled = response.status === 409 || response.status === 410; return; }
      copy = null;
      finished("Sent. Look at the screen.", "Your photo should appear there in a moment. You can put your phone away.");
      say("Sent", "ok");
    } catch {
      say("The connection dropped. Check your signal and try again.", "error"); send.disabled = false;
    }
  });
})();
