// US State Map Visualization with Language Data
const width = 960;
const height = 600;

// Create SVG container
const svg = d3.select("#map-container")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("border", "1px solid #ccc");

// Create projection and path generator
const projection = d3.geoAlbersUsa()
    .translate([width / 2, height / 2])
    .scale(800);

const path = d3.geoPath().projection(projection);

// Load data in parallel
Promise.all([
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
    d3.csv("data/LanguageData_States.csv"),
    d3.csv("data/us_statewise_population.csv")
]).then(([us, languageData, popData]) => {
    // Robustly parse speaker counts from strings to numbers
    function parseSpeakers(raw) {
        if (raw === undefined || raw === null) return null;
        let s = String(raw).trim();
        if (s === "") return null;

        // Remove parenthetical notes and commas
        s = s.replace(/\(.*?\)/g, "").replace(/,/g, "").trim();

        // Handle ranges like "1000-2000" or "1 000 - 2 000"
        const nums = s.match(/[0-9]+(?:\.[0-9]+)?/g);
        if (!nums) return null;
        const parsed = nums.map(n => parseFloat(n));

        if (s.includes("-") && parsed.length >= 2) {
            // average the range
            return (parsed[0] + parsed[parsed.length - 1]) / 2;
        }

        // If text includes a "<" (less than), use the number after it
        if (s.indexOf('<') !== -1 && parsed.length >= 1) {
            return parsed[0];
        }

        // Default: return the first found number
        return parsed[0];
    }

    languageData.forEach(d => {
        d.Speakers = parseSpeakers(d.Speakers);
    });

    // population parsing moved below (after canonicalStateName is defined)

    // Group language data by canonical state name (handle abbreviations and variants)
    const abbrevToName = {
        AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
        CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
        HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
        KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
        MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
        MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
        NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
        OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
        SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
        VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
        DC: "District of Columbia"
    };

    function canonicalStateName(raw) {
        if (raw === undefined || raw === null) return "Unknown";
        let s = String(raw).trim();
        if (s === "") return "Unknown";

        // Remove trailing/leading punctuation and extra whitespace
        s = s.replace(/[\.]/g, "").replace(/\s+/g, " ").trim();

        // If it's a two-letter code, map via abbrev
        if (s.length === 2) {
            const up = s.toUpperCase();
            if (abbrevToName[up]) return abbrevToName[up];
        }

        // Normalize common variants (remove word 'State', parentheses, etc.)
        let clean = s.replace(/\(.*?\)/g, "").replace(/\bstate\b/i, "").trim();

        // Try exact case-insensitive match against known names
        for (const name of Object.values(abbrevToName)) {
            if (name.toLowerCase() === clean.toLowerCase()) return name;
        }

        // Title-case fallback (e.g., 'california' -> 'California')
        const title = clean.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return title;
    }

    const languageByState = new Map();
    languageData.forEach(d => {
        const stateKey = canonicalStateName(d.State);
        if (!languageByState.has(stateKey)) languageByState.set(stateKey, []);
        languageByState.get(stateKey).push(d);
    });

    // Convert TopoJSON to GeoJSON
    const states = topojson.feature(us, us.objects.states).features;

    // Compute number of distinct languages per state
    const languageCountByState = new Map();
    languageByState.forEach((arr, state) => {
        const unique = new Set(arr.map(d => d.Language));
        languageCountByState.set(state, unique.size);
    });

    // Parse population data (use 2010 column and map by canonical state name)
    const populationByState = new Map();
    if (popData && popData.length) {
        popData.forEach(r => {
            // prefer 'Area' as state name and '2010' as population value
            const rawName = r.Area || r.State || r.NAME || r.Name || r.Geography || r.GeographyName;
            const rawPop = r['2010'] || r['2010 Population'] || r.Pop2010 || r.POP_2010 || r['2010 Population Estimate'] || r['2010_est'];
            if (!rawName) return;
            const name = canonicalStateName(rawName);
            let p = null;
            if (rawPop !== undefined) {
                const s = String(rawPop).replace(/,/g, '').trim();
                p = s === '' ? null : +s;
            }
            if (p != null && !isNaN(p)) populationByState.set(name, p);
        });
    }

    // Compute nationwide population (sum of available state populations)
    const nationwidePopulation = Array.from(populationByState.values()).reduce((a, b) => a + b, 0) || null;

    // Helper: build language totals for nationwide or a specific state
    function buildLanguageTotals(forState) {
        const totals = new Map();
        if (!forState) {
            // nationwide: sum across all languageData
            languageData.forEach(d => {
                const lang = d.Language || 'Unknown';
                const v = d.Speakers || 0;
                totals.set(lang, (totals.get(lang) || 0) + v);
            });
            return { totals, population: nationwidePopulation };
        }

        const arr = languageByState.get(forState) || [];
        arr.forEach(d => {
            const lang = d.Language || 'Unknown';
            const v = d.Speakers || 0;
            totals.set(lang, (totals.get(lang) || 0) + v);
        });
        const population = populationByState.get(forState) || null;
        return { totals, population };
    }

    // Setup pie chart containers and renderers
    const pieWidth = 380;
    const pieHeight = 380;
    const pieRadius = Math.min(pieWidth, pieHeight) / 2 - 18;

    // helper to create an SVG group inside a target box and ensure a .pie-info exists
    function createPieSvg(containerSelector) {
        // ensure info area exists
        const container = d3.select(containerSelector);
        container.selectAll('.pie-info').data([0]).join(
            enter => enter.append('div').attr('class', 'pie-info'),
            update => update
        );

        // remove previous svg and create new
        container.selectAll('svg').remove();
        const svgEl = container
            .append('svg')
            .attr('viewBox', `0 0 ${pieWidth} ${pieHeight}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');
        const g = svgEl.append('g').attr('transform', `translate(${pieWidth/2},${pieHeight/2})`);
        return { svgEl, g };
    }

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    function renderPieInto(groupG, containerSelector, totals, popForPct, captionText, normalizeExcluding) {
        // totals: Map lang->value
        let items = Array.from(totals.entries()).map(([lang, val]) => ({ lang, val }));
        items = items.filter(d => d.val && d.val > 0);

        if (normalizeExcluding && Array.isArray(normalizeExcluding)) {
            // remove excluded languages from items and renormalize relative to remaining sum
            items = items.filter(d => !normalizeExcluding.includes(d.lang));
            const sumRem = items.reduce((s,d)=>s+d.val,0) || 1;
            items.forEach(d => d.pct = d.val / sumRem);
        } else {
            items.forEach(d => d.pct = popForPct ? (d.val / popForPct) : 0);
        }

        // Aggregate items under 1% threshold (based on pct computed above)
        const major = items.filter(d => d.pct >= 0.01).sort((a,b)=>b.pct-a.pct);
        const minor = items.filter(d => d.pct < 0.01);
        const otherVal = minor.reduce((s,d)=>s+d.val,0);
        const otherPct = normalizeExcluding ? (otherVal / (items.reduce((s,d)=>s+d.val,0)||1)) : (otherVal / (popForPct||1));
        if (otherVal > 0) major.push({ lang: 'Other (<1%)', val: otherVal, pct: otherPct });

        const pie = d3.pie().sort(null).value(d => d.val);
        const arcs = pie(major);

        groupG.selectAll('.arc').remove();
        const arcGen = d3.arc().innerRadius(0).outerRadius(pieRadius);

        const g = groupG.selectAll('.arc').data(arcs).enter().append('g').attr('class','arc');
        g.append('path')
            .attr('d', arcGen)
            .attr('fill', d => d.data.lang === 'Other (<1%)' ? '#cccccc' : color(d.data.lang))
            .on('mouseover', function(event, d) {
                // show info in container's .pie-info
                try {
                    const info = d3.select(containerSelector).select('.pie-info');
                    info.text(`${d.data.lang}: ${((d.data.pct||0)*100).toFixed(2)}% (${d.data.val.toLocaleString()})`);
                } catch (e) {
                    // ignore
                }
            })
            .on('mouseout', function() {
                try { d3.select(containerSelector).select('.pie-info').text(''); } catch (e) {}
            });
        g.append('title').text(d => `${d.data.lang}: ${((d.data.pct||0)*100).toFixed(2)}% (${d.data.val.toLocaleString()})`);

        groupG.selectAll('.label').remove();
        groupG.append('g').attr('class','label').selectAll('text')
            .data(arcs)
            .enter().append('text')
            .attr('transform', d => `translate(${arcGen.centroid(d)})`)
            .attr('dy', '0.35em')
            .attr('font-size', 9)
            .attr('text-anchor', 'middle')
            .text(d => d.data.lang === 'Other (<1%)' ? 'Other' : d.data.lang);

        // caption
        d3.select(containerSelector).selectAll('.pie-caption').remove();
        d3.select(containerSelector).insert('div', ':first-child')
            .attr('class','pie-caption')
            .text(captionText + (popForPct ? ` | Population used: ${popForPct.toLocaleString()}` : ''));
    }

    function updatePieCharts(stateName) {
        const canonical = stateName ? canonicalStateName(stateName) : null;
        const { totals, population } = buildLanguageTotals(canonical);
        const popForPct = population || nationwidePopulation || Array.from(totals.values()).reduce((a,b)=>a+b,0);

        // create svgs/groups if not existing
        const left = createPieSvg('#pie-with-eng');
        const right = createPieSvg('#pie-no-eng');

        renderPieInto(left.g, '#pie-with-eng', totals, popForPct, (canonical ? `${canonical} — language shares (by 2010 population)` : 'Nationwide — language shares (by 2010 population)'), false);

        // For the right chart exclude English and renormalize among remaining languages
        renderPieInto(right.g, '#pie-no-eng', totals, popForPct, (canonical ? `${canonical} — excluding English (shares among non-English)` : 'Nationwide — excluding English (shares among non-English)'), ['English']);
    }

    // Populate the pie-state dropdown (independent from map clicks)
    const stateSet = new Set([...populationByState.keys(), ...languageByState.keys()]);
    stateSet.delete('Unknown');
    const stateList = Array.from(stateSet).sort((a,b)=>a.localeCompare(b));

    const select = d3.select('#pie-state-select');
    select.selectAll('option.state-option').data(stateList).join(
        enter => enter.append('option')
            .classed('state-option', true)
            .attr('value', d => d)
            .text(d => d)
    );

    select.on('change', function() {
        const val = this.value || null; // '' -> null means nationwide
        updatePieCharts(val);
    });

    // Initial pie: nationwide
    updatePieCharts(null);

    const counts = Array.from(languageCountByState.values());
    const minCount = counts.length ? d3.min(counts) : 0;
    const maxCount = counts.length ? d3.max(counts) : 1;

    const colorScale = d3.scaleLinear()
        .domain([minCount, maxCount])
        .range(["#deebf7", "#08306b"]);

    // Draw states with color based on language counts
    svg.selectAll("path")
        .data(states)
        .join("path")
        .attr("d", path)
        .attr("fill", function(d) {
            const name = canonicalStateName(getStateName(d));
            const count = languageCountByState.get(name) || 0;
            return count > 0 ? colorScale(count) : "#f0f0f0";
        })
        .attr("stroke", "#999")
        .attr("stroke-width", 0.75)
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
            d3.select(this)
                .attr("stroke", "#333")
                .attr("stroke-width", 2);
        })
        .on("mouseleave", function(event, d) {
            const stateName = canonicalStateName(getStateName(d));
            const isSelected = d3.select("#selected-state").text() === stateName;
            d3.select(this)
                .attr("stroke", "#999")
                .attr("stroke-width", isSelected ? 2 : 0.75);
        })
        .on("click", function(event, d) {
            const rawName = getStateName(d);
            const stateName = canonicalStateName(rawName);
            displayLanguages(stateName, languageByState);

            // Highlight selected state with a stronger stroke
            svg.selectAll("path")
                .attr("stroke", "#999")
                .attr("stroke-width", 0.75);

            d3.select(this)
                .attr("stroke", "#000")
                .attr("stroke-width", 2);
        });

    // Add legend: title + gradient scale
    (function addLegend() {
        // Guard against degenerate domain
        let legendMin = minCount;
        let legendMax = maxCount;
        if (legendMin === legendMax) {
            legendMin = 0;
            legendMax = legendMax || 1;
        }

        const legendWidth = 180;
        const legendHeight = 12;
        const legendX = width - legendWidth - 20;
        const legendY = 20;

        const defs = svg.append('defs');
        const lg = defs.append('linearGradient').attr('id', 'legend-gradient');
        lg.append('stop').attr('offset', '0%').attr('stop-color', colorScale(minCount));
        lg.append('stop').attr('offset', '100%').attr('stop-color', colorScale(maxCount));

        const legendGroup = svg.append('g')
            .attr('class', 'legend')
            .attr('transform', `translate(${legendX},${legendY})`);

        legendGroup.append('text')
            .attr('x', -150)
            .attr('y', -8)
            .attr('font-size', 12)
            .attr('font-family', 'Fira Sans, sans-serif')
            .text('Map representing the amount of languages spoken by state');

        legendGroup.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', legendWidth)
            .attr('height', legendHeight)
            .attr('fill', 'url(#legend-gradient)')
            .attr('stroke', '#ccc');

        const legendScale = d3.scaleLinear()
            .domain([legendMin, legendMax])
            .range([0, legendWidth]);

        const legendAxis = d3.axisBottom(legendScale)
            .ticks(4)
            .tickFormat(d3.format("~s"));

        legendGroup.append('g')
            .attr('transform', `translate(0,${legendHeight})`)
            .call(legendAxis)
            .selectAll('text')
            .attr('font-size', 10)
            .attr('font-family', 'Fira Sans, sans-serif');
    })();

    // --- Bar chart: top 15 languages by total speakers (with exclude options) ---
    function renderBarChart(excludeSet = new Set()) {
        try {
            // compute totals nationwide
            const totals = new Map();
            languageData.forEach(d => {
                const lang = d.Language || 'Unknown';
                const v = d.Speakers || 0;
                totals.set(lang, (totals.get(lang) || 0) + v);
            });

            const allItems = Array.from(totals.entries())
                .map(([lang, total]) => ({ lang, total }))
                .filter(d => d.total > 0)
                .sort((a,b) => b.total - a.total);

            // Filter out excluded languages and take top 15 of the remaining
            const items = allItems
                .filter(d => !excludeSet.has(d.lang))
                .slice(0, 15);

            const w = 920, h = 480, margin = {top: 20, right: 20, bottom: 50, left: 220};
            const innerW = w - margin.left - margin.right;
            const innerH = h - margin.top - margin.bottom;

            d3.select('#bar-container').selectAll('svg').remove();
            const svgBar = d3.select('#bar-container')
                .append('svg')
                .attr('viewBox', `0 0 ${w} ${h}`)
                .attr('preserveAspectRatio', 'xMidYMid meet')
                .attr('width', '100%')
                .attr('height', '100%');

            const g = svgBar.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

            const x = d3.scaleLinear().domain([0, d3.max(items, d => d.total) || 1]).range([0, innerW]).nice();
            const y = d3.scaleBand().domain(items.map(d => d.lang)).range([0, innerH]).padding(0.12);

            const xAxis = d3.axisBottom(x).ticks(6).tickFormat(d3.format('~s'));
            const yAxis = d3.axisLeft(y).tickSize(0);

            g.append('g').call(yAxis).selectAll('text').attr('font-size', 12).attr('font-family', 'Fira Sans, sans-serif');

            g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
                .append('text')
                .attr('x', innerW/2)
                .attr('y', 40)
                .attr('fill', '#000')
                .attr('text-anchor', 'middle')
                .text('Total speakers');

            const bars = g.selectAll('.bar').data(items).enter().append('g').attr('class','bar');

            bars.append('rect')
                .attr('x', 0)
                .attr('y', d => y(d.lang))
                .attr('height', d => y.bandwidth())
                .attr('width', d => x(d.total))
                .attr('fill', d => color(d.lang))
                .on('mouseover', function(event, d) {
                    const tooltip = d3.select('body').selectAll('.dot-tooltip').data([0]).join(
                        enter => enter.append('div').attr('class','dot-tooltip'),
                        update => update
                    );
                    tooltip.style('display','block').html(`<strong>${d.lang}</strong><br/>Speakers: ${d.total.toLocaleString()}`);
                })
                .on('mousemove', function(event) { d3.select('.dot-tooltip').style('left', (event.pageX+10)+'px').style('top', (event.pageY+10)+'px'); })
                .on('mouseout', function() { d3.select('.dot-tooltip').style('display','none'); });

            bars.append('text')
                .attr('class','bar-label')
                .attr('x', d => x(d.total) + 6)
                .attr('y', d => y(d.lang) + y.bandwidth()/2 + 4)
                .text(d => d.total.toLocaleString());

        } catch (err) {
            console.error('Error rendering bar chart:', err);
        }
    }

    // Initial bar chart render
    renderBarChart(new Set());

    // Attach checkbox handlers to rerender bar chart
    d3.select('#bar-english-check').on('change', function() {
        const exclude = new Set();
        if (!d3.select('#bar-english-check').property('checked')) exclude.add('English');
        if (!d3.select('#bar-spanish-check').property('checked')) exclude.add('Spanish');
        renderBarChart(exclude);
    });

    d3.select('#bar-spanish-check').on('change', function() {
        const exclude = new Set();
        if (!d3.select('#bar-english-check').property('checked')) exclude.add('English');
        if (!d3.select('#bar-spanish-check').property('checked')) exclude.add('Spanish');
        renderBarChart(exclude);
    });

    // --- Dot chart: states-count vs total speakers ---
    (function renderDotChart() {
        try {
            console.log('Rendering dot chart...');
        // Compute totals per language (nationwide)
        const totals = new Map();
        // total speakers per language
        languageData.forEach(d => {
            const lang = d.Language || 'Unknown';
            const v = d.Speakers || 0;
            totals.set(lang, (totals.get(lang) || 0) + v);
        });

        // count number of states where each language appears
        const statesCount = new Map();
        languageByState.forEach((arr, state) => {
            const langs = new Set(arr.map(d => d.Language));
            langs.forEach(l => statesCount.set(l, (statesCount.get(l) || 0) + 1));
        });

        // Exclude obvious outliers for the dotted chart
        const exclude = new Set(['English', 'Spanish']);

        const data = Array.from(totals.keys()).map(lang => ({
            lang,
            total: totals.get(lang) || 0,
            states: statesCount.get(lang) || 0
        })).filter(d => d.total > 0 && d.states > 0 && !exclude.has(d.lang));

        console.log('Dot chart data points:', data.length);

        // Chart size
        const w = 920, h = 360, margin = {top: 20, right: 20, bottom: 50, left: 70};
        const innerW = w - margin.left - margin.right;
        const innerH = h - margin.top - margin.bottom;

        // scales
        const xMax = d3.max(data, d => d.states) || 1;
        const yMax = d3.max(data, d => d.total) || 1;

        const x = d3.scaleLinear().domain([0, xMax]).range([0, innerW]).nice();
        const y = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]).nice();

        // svg
        d3.select('#dot-container').selectAll('svg').remove();
        const svgDot = d3.select('#dot-container')
            .append('svg')
            .attr('viewBox', `0 0 ${w} ${h}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .attr('width', '100%')
            .attr('height', '100%');

        const g = svgDot.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // draw background rect to show bounds and axes
        g.append('rect').attr('x', 0).attr('y', 0).attr('width', innerW).attr('height', innerH).attr('fill', 'none').attr('stroke', '#eee');

        // axes
        const xAxis = d3.axisBottom(x).ticks(Math.min(xMax, 10)).tickFormat(d3.format('d'));
        const yAxis = d3.axisLeft(y).ticks(6).tickFormat(d3.format('~s'));

        g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
            .append('text')
            .attr('x', innerW/2)
            .attr('y', 40)
            .attr('fill', '#000')
            .attr('text-anchor', 'middle')
            .text('Number of states');

        g.append('g').call(yAxis)
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -innerH/2)
            .attr('y', -50)
            .attr('fill', '#000')
            .attr('text-anchor', 'middle')
            .text('Total speakers');

        // tooltip element (absolute positioned)
        let tooltip = d3.select('body').selectAll('.dot-tooltip').data([0]).join(
            enter => enter.append('div').attr('class', 'dot-tooltip').style('display','none'),
            update => update
        );

        // points
        g.selectAll('circle.point')
            .data(data)
            .enter().append('circle')
            .classed('point', true)
            .attr('cx', d => x(d.states))
            .attr('cy', d => y(d.total))
            .attr('r', 4)
            .attr('fill', d => color(d.lang))
            .attr('opacity', 0.9)
            .on('mouseover', function(event, d) {
                tooltip.style('display','block').html(`<strong>${d.lang}</strong><br/>States: ${d.states}<br/>Speakers: ${d.total.toLocaleString()}`);
            })
            .on('mousemove', function(event) {
                tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY + 10) + 'px');
            })
            .on('mouseout', function() { tooltip.style('display','none'); });

        } catch (err) {
            console.error('Error rendering dot chart:', err);
        }

    })();

    function getStateName(d) {
        // Prefer any name property present in the GeoJSON feature
        if (d && d.properties) {
            if (d.properties.name) return d.properties.name;
            if (d.properties.NAME) return d.properties.NAME;
            if (d.properties.STATE_NAME) return d.properties.STATE_NAME;
            // Postal abbreviation field (many TopoJSONs use STUSPS or postal codes)
            const post = d.properties.stusps || d.properties.STUSPS || d.properties.postal || d.properties.POSTAL;
            if (post) {
                const mapped = abbrevToName[post.toUpperCase()];
                if (mapped) return mapped;
            }
        }

        // Fallback to id mapping (numeric FIPS)
        const stateIds = {
            "1": "Alabama", "2": "Alaska", "4": "Arizona", "5": "Arkansas", "6": "California",
            "8": "Colorado", "9": "Connecticut", "10": "Delaware", "12": "Florida", "13": "Georgia",
            "15": "Hawaii", "16": "Idaho", "17": "Illinois", "18": "Indiana", "19": "Iowa",
            "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland",
            "25": "Massachusetts", "26": "Michigan", "27": "Minnesota", "28": "Mississippi",
            "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada",
            "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
            "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma",
            "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina",
            "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah", "50": "Vermont",
            "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming"
        };

        if (d && d.id != null) return stateIds[d.id.toString()] || "Unknown";
        return "Unknown";
    }

    function displayLanguages(stateName, languageByState) {
        const container = d3.select("#languages-container");
        container.html(""); // Clear previous content

        const canonical = canonicalStateName(stateName);

            const stateLanguages = languageByState.get(canonical) || [];
            // Count distinct languages for the selected state
            const distinctCount = new Set(stateLanguages.map(d => d.Language)).size;
            d3.select("#selected-state").text(`${canonical}: ${distinctCount}`);

        // Filter languages with speaker data and sort by speakers
        const filteredLanguages = stateLanguages
            .filter(d => d.Speakers !== null)
            .sort((a, b) => (b.Speakers || 0) - (a.Speakers || 0));

        if (filteredLanguages.length === 0) {
            container.append("p")
                .text("No language data available for this state.");
            return;
        }

        // Create a table
        const table = container.append("table")
            .style("width", "100%")
            .style("border-collapse", "collapse")
            .style("margin-top", "20px");

        const thead = table.append("thead");
        thead.append("tr")
            .selectAll("th")
            .data(["Language", "Speakers"])
            .join("th")
            .text(d => d)
            .style("padding", "10px")
            .style("text-align", "left")
            .style("border-bottom", "2px solid #333")
            .style("font-weight", "bold");

        const tbody = table.append("tbody");
        tbody.selectAll("tr")
            .data(filteredLanguages)
            .join("tr")
            .selectAll("td")
            .data(d => [d.Language, d.Speakers !== null ? d.Speakers.toLocaleString() : 'N/A'])
            .join("td")
            .text(d => d)
            .style("padding", "8px")
            .style("border-bottom", "1px solid #ddd");
    }
}).catch(err => console.error("Error loading data:", err));
