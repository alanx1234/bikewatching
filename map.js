import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

console.log("Mapbox GL JS Loaded:", mapboxgl);

mapboxgl.accessToken =
  "pk.eyJ1IjoiYWx4aWExMjMiLCJhIjoiY21odmM4d281MDk1bzJtcHhoc2FjdTMydCJ9.WzkHY8IxJn1t1YKVMebRJA";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let stations = [];
let circles;
let radiusScale;

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

map.on("load", async () => {
  function updatePositions() {
    circles
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });
  map.addLayer({
    id: "boston-bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "#32D400",
      "line-width": 5,
      "line-opacity": 0.5,
    },
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });
  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "#32D400",
      "line-width": 5,
      "line-opacity": 0.5,
    },
  });

  const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  const jsonData = await d3.json(jsonurl);
  stations = jsonData.data.stations;

  const trips = await d3.csv(
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv",
    (t) => {
      t.started_at = new Date(t.started_at);
      t.ended_at = new Date(t.ended_at);
      const s = minutesSinceMidnight(t.started_at);
      const e = minutesSinceMidnight(t.ended_at);
      departuresByMinute[s].push(t);
      arrivalsByMinute[e].push(t);
      return t;
    }
  );

  const svg = d3.select("#map").select("svg");
  circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name)
    .enter()
    .append("circle")
    .attr("fill", "steelblue")
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .attr("opacity", 0.8);

  stations = computeStationTraffic(stations, -1);

  radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  circles
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .style("--departure-ratio", (d) =>
      stationFlow(d.departures / d.totalTraffic)
    )
    .each(function (d) {
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  updatePositions();
  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

const timeSlider = document.getElementById("time-slider");
const selectedTime = document.getElementById("selected-time");
const anyTimeLabel = document.getElementById("any-time");

function updateTimeDisplay() {
  let timeFilter = Number(timeSlider.value);
  if (timeFilter === -1) {
    selectedTime.textContent = "";
    anyTimeLabel.style.display = "block";
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = "none";
  }
  if (circles && radiusScale) updateScatterPlot(timeFilter);
}

timeSlider.addEventListener("input", updateTimeDisplay);
updateTimeDisplay();

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    const id = station.short_name;
    const dep = departures.get(id) ?? 0;
    const arr = arrivals.get(id) ?? 0;
    station.departures = dep;
    station.arrivals = arr;
    station.totalTraffic = dep + arr;
    return station;
  });
}

function updateScatterPlot(timeFilter) {
  const filteredStations = computeStationTraffic(stations, timeFilter);
  timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
  circles
    .data(filteredStations, (d) => d.short_name)
    .join("circle")
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );
}

