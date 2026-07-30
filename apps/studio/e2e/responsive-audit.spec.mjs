import { expect, test } from "@playwright/test";

test("keeps every rack region inside the page viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".chassis")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rackRegions = [...document.querySelectorAll(
      ".grid-top > *, .transport-row > *, .grid-mid > *, .grid-bottom > *, .right-rail > *",
    )]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: [...element.classList].find((name) => name.startsWith("rack-")) || element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    const touchTargets = [...document.querySelectorAll("button, select, input, label")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim().slice(0, 24),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      viewport: { width: viewportWidth, height: viewportHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportHeights: +(document.documentElement.scrollHeight / viewportHeight).toFixed(2),
      },
      rackRegions,
      outsideRegions: rackRegions.filter((region) => region.left < -1 || region.right > viewportWidth + 1),
      undersizedTouchTargets: matchMedia("(pointer: coarse)").matches
        ? touchTargets.filter((target) => target.width < 28 || target.height < 28)
        : [],
    };
  });

  await testInfo.attach("responsive-metrics", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
  console.log(`${testInfo.project.name}: ${JSON.stringify(metrics.document)} · ${metrics.undersizedTouchTargets.length} small touch targets`);
  if (metrics.undersizedTouchTargets.length) {
    console.log(`${testInfo.project.name} small targets: ${JSON.stringify(metrics.undersizedTouchTargets)}`);
  }

  expect(metrics.document.width).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.outsideRegions).toEqual([]);
});

test("compact rack navigation reaches and tracks distant controls", async ({ page }, testInfo) => {
  const compactProject = testInfo.project.name.startsWith("mobile")
    || testInfo.project.name === "tablet-portrait";
  test.skip(!compactProject, "Compact navigation is hidden above 900px");

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Rack sections" });
  await expect(navigation).toBeVisible();

  const kills = navigation.getByRole("button", { name: "Kills" });
  await kills.click();

  await expect(kills).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(page.locator("#rack-kills")).toBeInViewport();

  const inputs = navigation.getByRole("button", { name: "Inputs" });
  await inputs.click();
  await expect(inputs).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(300);
});
