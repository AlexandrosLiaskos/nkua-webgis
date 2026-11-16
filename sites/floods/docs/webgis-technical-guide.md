# Historic Floods: WebGIS

## Overview

An interactive WebGIS collection of peer-reviewed datasets of historic floods from around the world. The current flood catalogues are NKUA for Greece and HANZE for Europe. Greek rivers and river basins are available as geographic reference layers.

### Application architecture

```mermaid
flowchart TB
  n0["WebGIS<br/>Interactive map, per-record attribute tables, filters, search and statistics."]
  n1["NKUA catalogue API<br/>Read-only PostgREST API backed by PostgreSQL/PostGIS."]
  n2["Published geospatial data<br/>JSON and GeoJSON files."]
  n3["HANZE catalogue<br/>Flood records and affected regions."]
  n4["Greek reference layers<br/>Rivers and river basins."]
  n5["Basemap services<br/>External tile services."]
  n6["OpenFreeMap Positron<br/>Vector basemap."]
  n7["Esri World Imagery<br/>Satellite and aerial imagery (raster tiles)."]
  n0 --> n1
  n0 --> n2
  n2 --> n3
  n2 --> n4
  n0 --> n5
  n5 --> n6
  n5 --> n7
```

Figure 1. Current application architecture.

## Number of records

Interactive Gaussian-kernel record density, from zero to the maximum, in records per 10,000 km². Smoothing distance is adjustable.

## Dates of records

Interactive map of distance-weighted mean recorded year. Colours span the earliest to latest year in the loaded catalogue.

## Dataset sources

Interactive map of HANZE and NKUA shares, calculated from their local kernel-weighted record contributions. Intermediate colours show overlap; unsupported locations remain blank.

The maps use the full loaded catalogue independently of the main filters. HANZE locations are administrative display points. They describe catalogue distributions rather than flood hazard or observed flood extents.

## Citation

Evelpidou, N., Karkani, E., Saitis, G., Spyrou, E., & Liaskos, A. (2026). *Historic Floods* [Interactive WebGIS]. National and Kapodistrian University of Athens. [historicfloods.org](https://historicfloods.org/).
