const startup = document.getElementById("startup"),
  shell = document.getElementById("app-shell"),
  status = document.getElementById("startup-status");

const slowStartup = setTimeout(() => {
  startup.classList.add("slow");
  status.textContent = "Parimere is taking longer to open.";
}, 8000);

try {
  const { initPlatform } = await import("./platform.mjs");
  await initPlatform();
  const { startEditSession } = await import("./edit-session.mjs");
  const session = await startEditSession();
  const notice = document.getElementById("storage-notice");
  if (session !== "writable") {
    notice.hidden = false;
    notice.querySelector("p").textContent = session === "occupied"
      ? "Another Parimere tab is saving your work. Changes in this tab are temporary. Export anything you want to keep, then close the other tab and reload this one to enable saving."
      : "This browser cannot safely save Parimere data. You can compare and export files here. Use a current browser on HTTPS to enable saving.";
  }
  await import("./app.mjs");
  clearTimeout(slowStartup);
  shell.hidden = false;
  shell.inert = false;
  startup.setAttribute("aria-busy", "false");
  startup.hidden = true;
} catch (error) {
  clearTimeout(slowStartup);
  startup.classList.add("failed");
  startup.setAttribute("aria-busy", "false");
  status.textContent = "Parimere could not open.";
  console.error("Parimere startup failed:", error);
}
