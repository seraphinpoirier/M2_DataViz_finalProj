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
    .scale(1000);

const path = d3.geoPath().projection(projection);

// Load data in parallel
Promise.all([
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
    d3.csv("data/LanguageData_States.csv")
]).then(([us, languageData]) => {
    // Parse numeric fields
    languageData.forEach(d => {
        d.Speakers = d.Speakers ? +d.Speakers : null;
    });

    // Group language data by state
    const languageByState = d3.group(languageData, d => d.State);

    // Convert TopoJSON to GeoJSON
    const states = topojson.feature(us, us.objects.states).features;

    // Draw states
    svg.selectAll("path")
        .data(states)
        .join("path")
        .attr("d", path)
        .attr("fill", "#e5e5e5")
        .attr("stroke", "#999")
        .attr("stroke-width", 0.75)
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
            d3.select(this)
                .attr("fill", "#ffcc00")
                .attr("stroke-width", 2);
        })
        .on("mouseleave", function(event, d) {
            const stateName = getStateName(d);
            const isSelected = d3.select("#selected-state").text() === stateName;
            d3.select(this)
                .attr("fill", isSelected ? "#4da6ff" : "#e5e5e5")
                .attr("stroke-width", isSelected ? 2 : 0.75);
        })
        .on("click", function(event, d) {
            const stateName = getStateName(d);
            displayLanguages(stateName, languageByState);

            // Update all states colors
            svg.selectAll("path")
                .attr("fill", function(state) {
                    const name = getStateName(state);
                    return name === stateName ? "#4da6ff" : "#e5e5e5";
                })
                .attr("stroke-width", function(state) {
                    const name = getStateName(state);
                    return name === stateName ? 2 : 0.75;
                });
        });

    function getStateName(d) {
        // Map TopoJSON feature properties to state names
        // The ID in the TopoJSON is numeric, so we need to match it
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
        return stateIds[d.id.toString()] || "Unknown";
    }

    function displayLanguages(stateName, languageByState) {
        const container = d3.select("#languages-container");
        container.html(""); // Clear previous content

        d3.select("#selected-state").text(stateName);

        const stateLanguages = languageByState.get(stateName) || [];

        // Filter languages with speaker data and sort by speakers
        const filteredLanguages = stateLanguages
            .filter(d => d.Speakers !== null && d.Speakers !== "")
            .sort((a, b) => b.Speakers - a.Speakers);

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
            .data(d => [d.Language, d.Speakers.toLocaleString()])
            .join("td")
            .text(d => d)
            .style("padding", "8px")
            .style("border-bottom", "1px solid #ddd");
    }
}).catch(err => console.error("Error loading data:", err));
