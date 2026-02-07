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

    // Create tooltip for main map (state name)
    const mapTooltip = d3.select("body").append("div")
        .style("position", "absolute")
        .style("padding", "6px 10px")
        .style("background-color", "rgba(0,0,0,0.8)")
        .style("color", "#fff")
        .style("border-radius", "4px")
        .style("pointer-events", "none")
        .style("font-size", "12px")
        .style("font-family", "'Fira Sans', sans-serif")
        .style("opacity", 0);

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
            const stateName = canonicalStateName(getStateName(d));
            mapTooltip.style("opacity", 1).text(stateName);
            d3.select(this)
                .attr("stroke", "#333")
                .attr("stroke-width", 2);
        })
        .on("mousemove", function(event) {
            mapTooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseleave", function(event, d) {
            const stateName = canonicalStateName(getStateName(d));
            const isSelected = d3.select("#selected-state").text() === stateName;
            mapTooltip.style("opacity", 0);
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
        // Store data globally for filtering
        let dotChartData = null;
        
        function drawDotChart(highlightedLang = null) {
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
        dotChartData = data;
        
        // Populate datalist with language names
        const languageList = data.map(d => d.lang).sort();
        d3.select('#language-list').selectAll('option').data(languageList).join(
            enter => enter.append('option').attr('value', d => d),
            update => update
        );

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
            .attr('r', d => (highlightedLang && d.lang === highlightedLang) ? 8 : 4)
            .attr('fill', d => (highlightedLang && d.lang === highlightedLang) ? '#ff0000' : color(d.lang))
            .attr('opacity', d => (highlightedLang && d.lang !== highlightedLang) ? 0.2 : 0.9)
            .attr('stroke', d => (highlightedLang && d.lang === highlightedLang) ? '#333' : 'none')
            .attr('stroke-width', d => (highlightedLang && d.lang === highlightedLang) ? 2 : 0)
            .on('mouseover', function(event, d) {
                tooltip.style('display','block').html(`<strong>${d.lang}</strong><br/>States: ${d.states}<br/>Speakers: ${d.total.toLocaleString()}`);
            })
            .on('mousemove', function(event) {
                tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY + 10) + 'px');
            })
            .on('mouseout', function() { tooltip.style('display','none'); });
        }
        
        // Initial render
        drawDotChart();
        
        // Add event listener for language search
        d3.select('#language-search').on('input', function() {
            const searchValue = this.value.trim();
            drawDotChart(searchValue || null);
        });

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

    // ===========================
    // Box Plot: Proportion of People Who Don't Speak English Very Well
    // ===========================
    
    try {
        
        // Calculate "Speak English less than Very Well" by state
        const englishLessThanVeryWellByStateBoxplot = new Map();
        languageData.forEach(d => {
            const stateKey = canonicalStateName(d.State);
            let count = d["Speak English less than \"Very Well\""] || d['Speak English less than "Very Well"'];
            count = parseSpeakers(count);
            if (count !== null && count > 0) {
                const current = englishLessThanVeryWellByStateBoxplot.get(stateKey) || 0;
                englishLessThanVeryWellByStateBoxplot.set(stateKey, current + count);
            }
        });


        // Calculate proportions and collect data for box plot
        const proportionsForBoxplot = [];
        englishLessThanVeryWellByStateBoxplot.forEach((count, state) => {
            const pop = populationByState.get(state);
            if (pop && pop > 0) {
                const proportion = (count / pop) * 100;
                if (!isNaN(proportion) && isFinite(proportion)) {
                    proportionsForBoxplot.push({
                        state: state,
                        proportion: proportion
                    });
                }
            }
        });


        if (proportionsForBoxplot.length === 0) {
            console.warn("No valid proportion data for box plot");
            d3.select("#boxplot-container").append("p").text("No data available for box plot");
        } else {
            // Sort proportions for quartile calculation
            const proportionValues = proportionsForBoxplot.map(d => d.proportion).sort((a, b) => a - b);
            
            // Calculate quartiles and statistics
            function calculateQuartiles(data) {
                const sorted = [...data].sort((a, b) => a - b);
                const len = sorted.length;
                
                const q1Index = Math.floor(len * 0.25);
                const medianIndex = Math.floor(len * 0.5);
                const q3Index = Math.floor(len * 0.75);
                
                const q1 = sorted[q1Index];
                const median = sorted[medianIndex];
                const q3 = sorted[q3Index];
                const min = sorted[0];
                const max = sorted[len - 1];
                const iqr = q3 - q1;
                
                return { min, q1, median, q3, max, iqr };
            }
            
            const boxplotStats = calculateQuartiles(proportionValues);
            
            // D3 Box Plot (horizontal)
            const bpWidth = 1100;
            const bpHeight = 280;
            const bpMargin = { top: 20, right: 260, bottom: 50, left: 60 };
            const bpInnerWidth = bpWidth - bpMargin.left - bpMargin.right;
            const bpInnerHeight = bpHeight - bpMargin.top - bpMargin.bottom;
            
            const bpSvg = d3.select("#boxplot-container")
                .append("svg")
                .attr("viewBox", `0 0 ${bpWidth} ${bpHeight}`)
                .attr("preserveAspectRatio", "xMidYMid meet")
                .attr("width", "100%")
                .attr("height", "100%");
            
            const bpGroup = bpSvg.append("g")
                .attr("transform", `translate(${bpMargin.left},${bpMargin.top})`);
            
            // Scale for x-axis (proportion)
            const bpXScale = d3.scaleLinear()
                .domain([0, boxplotStats.max * 1.1])
                .range([0, bpInnerWidth]);

            const boxY = bpInnerHeight / 2;
            const boxHeight = 60;

            // Draw whisker line (min to max)
            bpGroup.append("line")
                .attr("x1", bpXScale(boxplotStats.min))
                .attr("x2", bpXScale(boxplotStats.max))
                .attr("y1", boxY)
                .attr("y2", boxY)
                .attr("stroke", "#333")
                .attr("stroke-width", 1);

            // Draw whisker caps
            bpGroup.append("line")
                .attr("x1", bpXScale(boxplotStats.min))
                .attr("x2", bpXScale(boxplotStats.min))
                .attr("y1", boxY - 20)
                .attr("y2", boxY + 20)
                .attr("stroke", "#333")
                .attr("stroke-width", 2);

            bpGroup.append("line")
                .attr("x1", bpXScale(boxplotStats.max))
                .attr("x2", bpXScale(boxplotStats.max))
                .attr("y1", boxY - 20)
                .attr("y2", boxY + 20)
                .attr("stroke", "#333")
                .attr("stroke-width", 2);

            // Draw box (Q1 to Q3)
            bpGroup.append("rect")
                .attr("x", bpXScale(boxplotStats.q1))
                .attr("y", boxY - boxHeight / 2)
                .attr("width", Math.max(1, bpXScale(boxplotStats.q3) - bpXScale(boxplotStats.q1)))
                .attr("height", boxHeight)
                .attr("fill", "#87CEEB")
                .attr("stroke", "#333")
                .attr("stroke-width", 2);

            // Draw median line
            bpGroup.append("line")
                .attr("x1", bpXScale(boxplotStats.median))
                .attr("x2", bpXScale(boxplotStats.median))
                .attr("y1", boxY - boxHeight / 2)
                .attr("y2", boxY + boxHeight / 2)
                .attr("stroke", "#d62728")
                .attr("stroke-width", 3);

            // Add x-axis
            const bpXAxis = d3.axisBottom(bpXScale).ticks(6).tickFormat(d3.format('.1f'));
            bpGroup.append("g")
                .attr("transform", `translate(0,${bpInnerHeight})`)
                .call(bpXAxis);

            // Add x-axis label
            bpSvg.append("text")
                .attr("x", bpMargin.left + (bpInnerWidth / 2))
                .attr("y", bpHeight - 12)
                .style("text-anchor", "middle")
                .style("font-size", "12px")
                .text("Proportion (%)");
            
            // Add statistics text
            const statsText = [
                `Min: ${boxplotStats.min.toFixed(2)}%`,
                `Q1: ${boxplotStats.q1.toFixed(2)}%`,
                `Median: ${boxplotStats.median.toFixed(2)}%`,
                `Q3: ${boxplotStats.q3.toFixed(2)}%`,
                `Max: ${boxplotStats.max.toFixed(2)}%`,
                `IQR: ${boxplotStats.iqr.toFixed(2)}%`
            ];
            
            const statsX = bpInnerWidth + 20;
            const statsY = boxY - 40;

            bpGroup.append("text")
                .attr("x", statsX)
                .attr("y", statsY)
                .attr("font-size", "11px")
                .attr("font-family", "monospace")
                .text("Statistics:")
                .style("font-weight", "bold");
            
            statsText.forEach((stat, index) => {
                bpGroup.append("text")
                    .attr("x", statsX)
                    .attr("y", statsY + 20 + (index * 16))
                    .attr("font-size", "11px")
                    .attr("font-family", "monospace")
                    .text(stat);
            });
        }
    } catch (error) {
        console.error("Error creating box plot:", error);
        d3.select("#boxplot-container").append("p").text("Error: " + error.message);
    }

    // ===========================
    // English Proficiency Map
    // ===========================
    const epWidth = 960;
    const epHeight = 600;

    const epSvg = d3.select("#english-proficiency-map-container")
        .append("svg")
        .attr("width", epWidth)
        .attr("height", epHeight)
        .style("border", "1px solid #ccc");

    const epProjection = d3.geoAlbersUsa()
        .translate([epWidth / 2, epHeight / 2])
        .scale(850);

    const epPath = d3.geoPath().projection(epProjection);

    // Calculate "Speak English less than Very Well" by state
    const englishLessThanVeryWellByState = new Map();
    languageData.forEach(d => {
        const stateKey = canonicalStateName(d.State);
        let count = d["Speak English less than \"Very Well\""] || d['Speak English less than "Very Well"'];
        count = parseSpeakers(count);
        if (count !== null) {
            const current = englishLessThanVeryWellByState.get(stateKey) || 0;
            englishLessThanVeryWellByState.set(stateKey, current + count);
        }
    });

    // Calculate proportions: (less than very well / total population) * 100
    const englishProficiencyProportions = new Map();
    englishLessThanVeryWellByState.forEach((count, state) => {
        const pop = populationByState.get(state) || 1;
        const proportion = (count / pop) * 100;
        englishProficiencyProportions.set(state, proportion);
    });

    // Create red color scale: light red (#fee5d9) to dark red (#a50f15)
    const proportions = Array.from(englishProficiencyProportions.values());
    const epMinProp = Math.min(...proportions);
    const epMaxProp = Math.max(...proportions);

    const epColorScale = d3.scaleLinear()
        .domain([epMinProp, epMaxProp])
        .range(["#fee5d9", "#a50f15"]);

    // Create tooltip for English Proficiency map
    const epTooltip = d3.select("body").append("div")
        .style("position", "absolute")
        .style("padding", "8px 12px")
        .style("background-color", "#333")
        .style("color", "#fff")
        .style("border-radius", "4px")
        .style("pointer-events", "none")
        .style("font-size", "12px")
        .style("opacity", 0);

    // Draw states on the English Proficiency map
    epSvg.selectAll("path")
        .data(states)
        .enter()
        .append("path")
        .attr("d", epPath)
        .attr("fill", d => {
            const stateName = canonicalStateName(getStateName(d));
            const proportion = englishProficiencyProportions.get(stateName) || 0;
            return proportion > 0 ? epColorScale(proportion) : "#f0f0f0";
        })
        .attr("stroke", "#999")
        .attr("stroke-width", 0.75)
        .on("mouseenter", function(event, d) {
            const stateName = canonicalStateName(getStateName(d));
            const proportion = englishProficiencyProportions.get(stateName) || 0;
            epTooltip
                .style("opacity", 1)
                .text(`${stateName}: ${proportion.toFixed(2)}%`);
            d3.select(this)
                .attr("stroke", "#333")
                .attr("stroke-width", 2);
        })
        .on("mousemove", function(event) {
            epTooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseleave", function() {
            epTooltip.style("opacity", 0);
            d3.select(this)
                .attr("stroke", "#999")
                .attr("stroke-width", 0.75);
        });

    // Add legend for English Proficiency map
    (function addEnglishProficiencyLegend() {
        const legendWidth = 180;
        const legendHeight = 12;
        const legendX = epWidth - legendWidth - 20;
        const legendY = 520;

        const defs = epSvg.append('defs');
        const lg = defs.append('linearGradient').attr('id', 'ep-legend-gradient');
        lg.append('stop').attr('offset', '0%').attr('stop-color', epColorScale(epMinProp));
        lg.append('stop').attr('offset', '100%').attr('stop-color', epColorScale(epMaxProp));

        // Title
        epSvg.append('text')
            .attr('x', legendX)
            .attr('y', legendY - 15)
            .attr('font-size', 12)
            .attr('font-weight', 'bold')
            .text('English < "Very Well" (%)');

        // Gradient bar
        epSvg.append('rect')
            .attr('x', legendX)
            .attr('y', legendY)
            .attr('width', legendWidth)
            .attr('height', legendHeight)
            .attr('fill', 'url(#ep-legend-gradient)');

        // Legend axis
        const epLegendScale = d3.scaleLinear()
            .domain([epMinProp, epMaxProp])
            .range([0, legendWidth]);

        const epLegendAxis = d3.axisBottom(epLegendScale)
            .ticks(4)
            .tickFormat(d3.format('.1f'));

        epSvg.append('g')
            .attr('transform', `translate(${legendX},${legendY + legendHeight})`)
            .call(epLegendAxis)
            .selectAll('text')
            .attr('font-size', 10);
    })();

    // ===========================
    // English Proficiency Histogram
    // ===========================
    
    // Aggregate "Speak English less than Very Well" by state
    const englishLessVeryWellByState = new Map();
    const englishErrorByState = new Map();
    
    languageData.forEach(d => {
        const stateKey = canonicalStateName(d.State);
        const value = parseSpeakers(d["Speak English less than \"Very Well\""] || d['Speak English less than "Very Well"']) || 0;
        const error = parseSpeakers(d["Margin of Error (Speak English Less than Very Well)"]) || 0;
        
        if (value > 0) {
            const currentVal = englishLessVeryWellByState.get(stateKey) || 0;
            const currentErr = englishErrorByState.get(stateKey) || [];
            
            englishLessVeryWellByState.set(stateKey, currentVal + value);
            currentErr.push(error);
            englishErrorByState.set(stateKey, currentErr);
        }
    });
    
    // Compute RMS (root mean square) of errors per state
    const englishErrorRMSByState = new Map();
    englishErrorByState.forEach((errors, state) => {
        const sumSquares = errors.reduce((s, e) => s + e * e, 0);
        const rms = Math.sqrt(sumSquares);
        englishErrorRMSByState.set(state, rms);
    });
    
    // Calculate nationwide totals
    let nationwideLessVeryWell = 0;
    let nationwideErrors = [];
    languageData.forEach(d => {
        const value = parseSpeakers(d["Speak English less than \"Very Well\""] || d['Speak English less than "Very Well"']) || 0;
        const error = parseSpeakers(d["Margin of Error (Speak English Less than Very Well)"]) || 0;
        nationwideLessVeryWell += value;
        if (error > 0) nationwideErrors.push(error);
    });
    const nationwideErrorRMS = Math.sqrt(nationwideErrors.reduce((s, e) => s + e * e, 0));
    
    // Build histogram data: states ordered by value
    let statesData = Array.from(englishLessVeryWellByState.entries()).map(([state, value]) => ({
        name: state,
        value: value,
        error: englishErrorRMSByState.get(state) || 0,
        isNationwide: false
    }));
    
    // Sort by value descending and keep only top 15
    statesData.sort((a, b) => b.value - a.value);
    statesData = statesData.slice(0, 15);
    
    // Build histogram data with nationwide
    let histogramData = statesData;
    
    // Add nationwide as first item (will be toggled)
    histogramData.unshift({
        name: 'Nationwide',
        value: nationwideLessVeryWell,
        error: nationwideErrorRMS,
        isNationwide: true
    });
    
    // Render histogram
    function renderEnglishHistogram(includeNationwide = true) {
        // Filter data based on nationwide checkbox
        let data = includeNationwide ? histogramData : histogramData.filter(d => !d.isNationwide);
        
        // Clear previous
        d3.select("#english-histogram-container").selectAll("svg").remove();
        
        const hisWidth = 920;
        const hisHeight = Math.max(400, data.length * 25 + 100);
        
        const hisSvg = d3.select("#english-histogram-container")
            .append("svg")
            .attr("width", hisWidth)
            .attr("height", hisHeight)
            .style("border", "1px solid #ccc");
        
        const hisMargin = { top: 20, right: 40, bottom: 50, left: 180 };
        const hisPlotWidth = hisWidth - hisMargin.left - hisMargin.right;
        const hisPlotHeight = hisHeight - hisMargin.top - hisMargin.bottom;
        
        const hisG = hisSvg.append("g")
            .attr("transform", `translate(${hisMargin.left},${hisMargin.top})`);
        
        // Scales
        const hisXScale = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.value + d.error) || 1])
            .range([0, hisPlotWidth]);
        
        const hisYScale = d3.scaleBand()
            .domain(data.map(d => d.name))
            .range([0, hisPlotHeight])
            .padding(0.4);
        
        // Color: red for nationwide, blue for states
        const hisColor = d => d.isNationwide ? "#d62728" : "#1f77b4";
        
        // Draw bars
        hisG.selectAll(".bar")
            .data(data)
            .join("rect")
            .attr("class", "bar")
            .attr("x", 0)
            .attr("y", d => hisYScale(d.name))
            .attr("width", d => hisXScale(d.value))
            .attr("height", hisYScale.bandwidth())
            .attr("fill", hisColor)
            .style("opacity", 0.8)
            .style("cursor", "pointer")
            .on("mouseover", function(event, d) {
                d3.select(this).style("opacity", 1);
            })
            .on("mouseout", function() {
                d3.select(this).style("opacity", 0.8);
            });
        
        // Draw error bars
        hisG.selectAll(".error-bar")
            .data(data)
            .join("g")
            .attr("class", "error-bar")
            .append("line")
            .attr("x1", d => hisXScale(d.value))
            .attr("x2", d => hisXScale(d.value))
            .attr("y1", d => hisYScale(d.name))
            .attr("y2", d => hisYScale(d.name) + hisYScale.bandwidth())
            .attr("stroke", d => hisColor(d))
            .attr("stroke-width", 1.5);
        
        // Error bar caps
        hisG.selectAll(".error-bar-cap-left")
            .data(data)
            .join("line")
            .attr("class", "error-bar-cap-left")
            .attr("x1", d => hisXScale(Math.max(0, d.value - d.error)))
            .attr("x2", d => hisXScale(Math.max(0, d.value - d.error)))
            .attr("y1", d => hisYScale(d.name) + hisYScale.bandwidth() / 4)
            .attr("y2", d => hisYScale(d.name) + hisYScale.bandwidth() * 3 / 4)
            .attr("stroke", d => hisColor(d))
            .attr("stroke-width", 1.5);
        
        hisG.selectAll(".error-bar-cap-right")
            .data(data)
            .join("line")
            .attr("class", "error-bar-cap-right")
            .attr("x1", d => hisXScale(d.value + d.error))
            .attr("x2", d => hisXScale(d.value + d.error))
            .attr("y1", d => hisYScale(d.name) + hisYScale.bandwidth() / 4)
            .attr("y2", d => hisYScale(d.name) + hisYScale.bandwidth() * 3 / 4)
            .attr("stroke", d => hisColor(d))
            .attr("stroke-width", 1.5);
        
        // Draw value labels
        hisG.selectAll(".bar-label")
            .data(data)
            .join("text")
            .attr("class", "bar-label")
            .attr("x", d => hisXScale(d.value) + 5)
            .attr("y", d => hisYScale(d.name) + hisYScale.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("font-size", 11)
            .text(d => d.value.toLocaleString());
        
        // X-axis
        hisG.append("g")
            .attr("transform", `translate(0,${hisPlotHeight})`)
            .call(d3.axisBottom(hisXScale).tickFormat(d3.format("~s")))
            .append("text")
            .attr("x", hisPlotWidth / 2)
            .attr("y", 40)
            .attr("fill", "black")
            .attr("font-size", 12)
            .text("Number of People");
        
        // Y-axis
        hisG.append("g")
            .call(d3.axisLeft(hisYScale));
    }
    
    // Initial render
    renderEnglishHistogram(true);
    
    // Checkbox handler
    d3.select("#histogram-nationwide-check").on("change", function() {
        const includeNationwide = this.checked;
        renderEnglishHistogram(includeNationwide);
    });

    // Export key data/functions to window so other initialization blocks can access them
    window.languageData = languageData;
    window.states = states;
    window.populationByState = populationByState;
    window.canonicalStateName = canonicalStateName;
    window.getStateName = getStateName;

}).catch(err => console.error("Error loading data:", err));

// ===========================
// Per-language choropleth map
// ===========================
// This block runs after the main Promise above — we attach behavior by wrapping in a short timeout
// Setup language map once required globals exist
(function setupLang(){
    if (typeof window.languageData === 'undefined' || typeof window.states === 'undefined') {
        setTimeout(setupLang, 100);
        return;
    }

    try {
        const languageData = window.languageData;
        const states = window.states;
        const populationByState = window.populationByState || new Map();
        const canonicalStateName = window.canonicalStateName;
        const getStateName = window.getStateName;

        // Build language list
        const languageSet = new Set(languageData.map(d => d.Language).filter(Boolean));
        const languageList = Array.from(languageSet).sort((a,b) => a.localeCompare(b));

        // Populate datalist
        const dl = d3.select('#language-map-list');
        dl.selectAll('option').data(languageList).join(
            enter => enter.append('option').attr('value', d => d),
            update => update
        );

        // Tooltip for the language map
        const langTooltip = d3.select('body').append('div')
            .style('position','absolute')
            .style('padding','8px 10px')
            .style('background','rgba(0,0,0,0.8)')
            .style('color','#fff')
            .style('border-radius','4px')
            .style('pointer-events','none')
            .style('font-size','12px')
            .style('opacity',0);

        // render function
        function renderLanguageMap(language) {
            // clear container
            d3.select('#language-map-container').selectAll('*').remove();

            const container = d3.select('#language-map-container');
            const w = 960, h = 600;
            const svgLang = container.append('svg')
                .attr('width', '100%')
                .attr('viewBox', `0 0 ${w} ${h}`)
                .attr('preserveAspectRatio', 'xMidYMid meet');

            const langProj = d3.geoAlbersUsa().translate([w/2,h/2]).scale(850);
            const langPath = d3.geoPath().projection(langProj);

            // If no language provided, draw blank base map and return
            if (!language) {
                svgLang.selectAll('path')
                    .data(states)
                    .enter().append('path')
                    .attr('d', langPath)
                    .attr('fill', '#f0f0f0')
                    .attr('stroke', '#ccc')
                    .attr('stroke-width', 0.8);

                svgLang.append('text')
                    .attr('x', 20)
                    .attr('y', 28)
                    .attr('font-size', 14)
                    .attr('fill', '#333')
                    .text('No language selected');

                return;
            }

            // aggregate speakers of the chosen language by state
            const speakersByState = new Map();
            languageData.forEach(d => {
                if (!d.Language) return;
                if (d.Language.toLowerCase() !== language.toLowerCase()) return;
                const state = canonicalStateName(d.State);
                const v = d.Speakers || 0;
                speakersByState.set(state, (speakersByState.get(state) || 0) + v);
            });

            // compute percent by state (speakers / population *100)
            const percentByState = new Map();
            speakersByState.forEach((val, state) => {
                const pop = populationByState.get(state) || null;
                const pct = pop ? (val / pop) * 100 : null;
                percentByState.set(state, pct);
            });

            // domain for color: use percent values (ignore nulls)
            const percents = Array.from(percentByState.values()).filter(v => v != null && !isNaN(v));
            const minP = percents.length ? d3.min(percents) : 0;
            const maxP = percents.length ? d3.max(percents) : 1;

            const langColor = d3.scaleLinear()
                .domain([minP, maxP])
                .range(['#e5f5e0','#006d2c']);

            // draw states
            svgLang.selectAll('path')
                .data(states)
                .enter().append('path')
                .attr('d', langPath)
                .attr('fill', d => {
                    const name = canonicalStateName(getStateName(d));
                    const pct = percentByState.get(name);
                    return (pct != null && !isNaN(pct)) ? langColor(pct) : '#f0f0f0';
                })
                .attr('stroke','#999')
                .attr('stroke-width',0.8)
                .on('mouseenter', function(event, d) {
                    const name = canonicalStateName(getStateName(d));
                    const speakers = speakersByState.get(name) || 0;
                    const pct = percentByState.get(name);
                    const pctText = (pct == null || isNaN(pct)) ? 'N/A' : pct.toFixed(2) + '%';
                    langTooltip.style('opacity',1)
                        .html(`<strong>${name}</strong><br/>${speakers.toLocaleString()} speakers<br/>${pctText} of state`);
                    d3.select(this).attr('stroke','#333').attr('stroke-width',2);
                })
                .on('mousemove', function(event) {
                    langTooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 28) + 'px');
                })
                .on('mouseleave', function(event, d) {
                    langTooltip.style('opacity',0);
                    d3.select(this).attr('stroke','#999').attr('stroke-width',0.8);
                });

            // legend (inside a small box)
            (function addLangLegend() {
                const legendW = 180, legendH = 12;
                const pad = 10;
                const lx = w - legendW - 40, ly = 20;

                const defs = svgLang.append('defs');
                const lg = defs.append('linearGradient').attr('id','lang-legend-gradient');
                lg.append('stop').attr('offset','0%').attr('stop-color', langColor(minP));
                lg.append('stop').attr('offset','100%').attr('stop-color', langColor(maxP));

                const group = svgLang.append('g').attr('transform', `translate(${lx - pad},${ly - pad})`);
                // background box
                group.append('rect')
                    .attr('x', 0)
                    .attr('y', 0)
                    .attr('width', legendW + pad*2)
                    .attr('height', legendH + 44)
                    .attr('rx', 6)
                    .attr('ry', 6)
                    .attr('fill', '#fff')
                    .attr('stroke', '#ddd')
                    .attr('opacity', 0.95);

                // title
                group.append('text')
                    .attr('x', pad)
                    .attr('y', 16)
                    .attr('font-size', 12)
                    .attr('font-weight', 'bold')
                    .text(`${language} (% of state)`);

                // gradient bar
                group.append('rect')
                    .attr('x', pad)
                    .attr('y', 24)
                    .attr('width', legendW)
                    .attr('height', legendH)
                    .attr('fill', 'url(#lang-legend-gradient)');

                const legendScale = d3.scaleLinear().domain([minP, maxP]).range([0, legendW]);
                const legendAxis = d3.axisBottom(legendScale).ticks(4).tickFormat(d3.format('.2f'));
                group.append('g')
                    .attr('transform', `translate(${pad},${24 + legendH})`)
                    .call(legendAxis)
                    .selectAll('text').attr('font-size', 10);
            })();
        }

        // input handling
        const input = d3.select('#language-map-search');
        input.on('input', function() {
            const val = this.value && this.value.trim();
            renderLanguageMap(val || null);
        });

        // Render base map initially
        renderLanguageMap(null);

    } catch (err) {
        console.error('Error setting up language search map:', err);
    }

})();
