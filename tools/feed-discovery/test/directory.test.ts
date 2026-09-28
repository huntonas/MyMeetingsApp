import { describe, expect, it } from "vitest";

import { parseDirectoryPage } from "../src/directory";

const page = `
<div class="area-loc-item"><h3>AA Vermont District 11</h3><address> Chittenden County , Vermont </address>
<p><a href="http://www.aavt.org" target="_blank" rel="nofollow">http://www.aavt.org</a><br><span>Answering Service:</span>(802) 802-2288</p></div>
<div class="area-loc-item"><h3>Burlington Area Intergroup</h3><address> Burlington , Vermont </address>
<p><a href="https://burlingtonaa.org/" rel="nofollow">https://burlingtonaa.org/</a></p></div>
<div class="area-loc-item"><h3>Oficina Central Hispana</h3><address> Rutland , Vermont </address><p><span>Phone:</span>(802) 555-0100</p></div>
<div class="area-loc-item"><h3>Northern Vermont Answering Service</h3><address> Barre , Vermont </address>
<p><a href="https://nvtaa.org" rel="nofollow">https://nvtaa.org</a></p></div>
<div class="related-areas"><h4>Area 070 - Vermont</h4><div class="field--name-field-url"><a href="http://www.aavt.org">http://www.aavt.org</a></div></div>`;

describe("parseDirectoryPage", () => {
  it("parses entities, infers their type from the name, and adds the area footer", () => {
    expect(parseDirectoryPage(page, "VT")).toEqual([
      {
        id: "aa-vermont-district-11-chittenden-county-vt",
        name: "AA Vermont District 11",
        entityType: "district",
        state: "VT",
        website: "http://www.aavt.org",
        notes: "",
      },
      {
        id: "burlington-area-intergroup-burlington-vt",
        name: "Burlington Area Intergroup",
        entityType: "intergroup",
        state: "VT",
        website: "https://burlingtonaa.org",
        notes: "",
      },
      {
        id: "oficina-central-hispana-rutland-vt",
        name: "Oficina Central Hispana",
        entityType: "central_office",
        state: "VT",
        website: null,
        notes: "no website listed",
      },
      {
        id: "northern-vermont-answering-service-barre-vt",
        name: "Northern Vermont Answering Service",
        entityType: "intergroup",
        state: "VT",
        website: "https://nvtaa.org",
        notes: "type inferred",
      },
      {
        // Areas id by name alone (no state): the same area repeats verbatim across every state page
        // it's related to, and area names are unique nationwide.
        id: "area-070-vermont",
        name: "Area 070 - Vermont",
        entityType: "area",
        state: "VT",
        website: "http://www.aavt.org",
        notes: "",
      },
    ]);
  });

  it("ignores links that aren't http(s)", () => {
    const html = `<div class="area-loc-item"><h3>X Intergroup</h3><address>A, Vermont</address><p><a href="mailto:x@y.org">x</a></p></div>`;
    expect(parseDirectoryPage(html, "VT")[0]?.website).toBeNull();
  });

  it("returns nothing for a page with no listings", () => {
    expect(parseDirectoryPage("<html><body>none</body></html>", "VT")).toEqual([]);
  });

  // Real aa.org state pages nest several areas inside one `.related-areas` footer block (a `.area-wrapper`
  // per area, each holding its own `h4` and link) rather than a single h4/link pair, confirmed against a
  // saved copy of the real CA page.
  it("pairs every h4 in a footer block with the link that follows it, in order", () => {
    const html = `
<div class="related-areas"><div class="areas">
  <div class="area"><div class="area-wrapper">
    <div class="field field--name-name field--type-string field--label-hidden field__item"><h4>Area 001 - Example Region</h4></div>
    <div class="field field--name-field-url field--type-link field--label-hidden field__item"><a href="http://example-area1.example" class="external-link" target="_blank">http://example-area1.example</a></div>
  </div><div class="area-wrapper">
    <div class="field field--name-name field--type-string field--label-hidden field__item"><h4>Area 002 - Example Coast</h4></div>
    <div class="field field--name-field-url field--type-link field--label-hidden field__item"><a href="http://example-area2.example" class="external-link" target="_blank">http://example-area2.example</a></div>
  </div></div></div>`;
    expect(parseDirectoryPage(html, "VT")).toEqual([
      {
        id: "area-001-example-region",
        name: "Area 001 - Example Region",
        entityType: "area",
        state: "VT",
        website: "http://example-area1.example",
        notes: "",
      },
      {
        id: "area-002-example-coast",
        name: "Area 002 - Example Coast",
        entityType: "area",
        state: "VT",
        website: "http://example-area2.example",
        notes: "",
      },
    ]);
  });

  // Real aa.org state pages also render the full worldwide (and, on the "All" page, Canada) office
  // directory in the same markup, outside a `.view-display-id-us` wrapper, so the page's own state
  // filtering happens client-side. Confirmed against saved copies of the real CA and "All" pages: an
  // unscoped `.area-loc-item`/`.related-areas` query would pull in hundreds of unrelated entities.
  it("only reads entities inside the .view-display-id-us wrapper when one is present", () => {
    const html = `
<div class="view-display-id-us">
  <div class="area-loc-item"><h3>Example Intergroup</h3><address> Example City , Vermont </address>
  <p><a href="https://example-intergroup.example">https://example-intergroup.example</a></p></div>
  <div class="related-areas"><h4>Area 001 - Example Region</h4><div class="field--name-field-url"><a href="http://example-area1.example">http://example-area1.example</a></div></div>
</div>
<div class="view-display-id-ww">
  <div class="area-loc-item"><h3>Should Not Appear Central Office</h3><address> Nowhere , Farland </address>
  <p><a href="https://should-not-appear.example">https://should-not-appear.example</a></p></div>
  <div class="related-areas"><h4>Area 999 - Should Not Appear</h4><div class="field--name-field-url"><a href="http://should-not-appear.example">http://should-not-appear.example</a></div></div>
</div>`;
    expect(parseDirectoryPage(html, "VT")).toEqual([
      {
        id: "example-intergroup-example-city-vt",
        name: "Example Intergroup",
        entityType: "intergroup",
        state: "VT",
        website: "https://example-intergroup.example",
        notes: "",
      },
      {
        id: "area-001-example-region",
        name: "Area 001 - Example Region",
        entityType: "area",
        state: "VT",
        website: "http://example-area1.example",
        notes: "",
      },
    ]);
  });

  // Controller fix round 1, item 1: same-named offices must not collide just because entityId used to
  // ignore the office's city.
  it("gives same-named offices in different cities distinct ids", () => {
    const html = `
<div class="area-loc-item"><h3>24 Hour Answering Service</h3><address> Example City , Vermont </address>
<p><a href="https://example-a.example">https://example-a.example</a></p></div>
<div class="area-loc-item"><h3>24 Hour Answering Service</h3><address> Other City , Vermont </address>
<p><a href="https://example-b.example">https://example-b.example</a></p></div>`;
    expect(parseDirectoryPage(html, "VT").map((found) => found.id)).toEqual([
      "24-hour-answering-service-example-city-vt",
      "24-hour-answering-service-other-city-vt",
    ]);
  });

  it("gives the same area footer the same id when parsed from two different state pages", () => {
    const footer = `<div class="related-areas"><h4>Area 070 - Vermont</h4><div class="field--name-field-url"><a href="http://www.aavt.org">http://www.aavt.org</a></div></div>`;
    const [fromVt] = parseDirectoryPage(footer, "VT");
    const [fromNh] = parseDirectoryPage(footer, "NH");
    expect(fromVt?.id).toBe("area-070-vermont");
    expect(fromNh?.id).toBe("area-070-vermont");
    // The id collapses across states, but the entity's own state still reflects the page it came from.
    expect(fromVt?.state).toBe("VT");
    expect(fromNh?.state).toBe("NH");
  });

  it("suffixes an exact duplicate (same name, city and state) on one page with -2", () => {
    const html = `
<div class="area-loc-item"><h3>Example Intergroup</h3><address> Example City , Vermont </address>
<p><a href="https://example-a.example">https://example-a.example</a></p></div>
<div class="area-loc-item"><h3>Example Intergroup</h3><address> Example City , Vermont </address>
<p><a href="https://example-b.example">https://example-b.example</a></p></div>`;
    expect(parseDirectoryPage(html, "VT").map((found) => found.id)).toEqual([
      "example-intergroup-example-city-vt",
      "example-intergroup-example-city-vt-2",
    ]);
  });

  // Controller fix round 1, item 2: the Spanish "Intergrupo" wasn't recognized by the old regex.
  it("recognizes the Spanish 'Intergrupo' name as an intergroup", () => {
    const html = `<div class="area-loc-item"><h3>Intergrupo Ejemplo</h3><address> Example City , Vermont </address>
<p><a href="https://example.example">https://example.example</a></p></div>`;
    const [found] = parseDirectoryPage(html, "VT");
    expect(found?.entityType).toBe("intergroup");
    expect(found?.notes).toBe("");
  });

  it("collapses runs of whitespace in office and area names", () => {
    const html = `<div class="area-loc-item"><h3> Area 27  District 6\n Hotline </h3><address> Moses Lake , Washington </address>
<p><a href="https://example.example">https://example.example</a></p></div>
<div class="related-areas"><h4>Area 072  -  Western   Washington</h4><div class="field--name-field-url"><a href="https://area72aa.org">https://area72aa.org</a></div></div>`;
    expect(parseDirectoryPage(html, "WA").map((found) => found.name)).toEqual([
      "Area 27 District 6 Hotline",
      "Area 072 - Western Washington",
    ]);
  });
});
