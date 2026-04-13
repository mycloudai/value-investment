/* ═══════════════════════════════════════════════════
   graph.js - Knowledge Graph with D3.js v7 (SPA)
   ═══════════════════════════════════════════════════ */
(function() {
  var COLORS = {
    'shareholder-letter': '#2563EB',
    'partnership-letter': '#1D4ED8',
    'concept':            '#38BDF8',
    'company':            '#60A5FA',
    'person':             '#A78BFA',
    'special-letter':     '#818CF8'
  };

  function initGraph() {
    var container = document.getElementById('graph-container');
    var tooltip = document.getElementById('graph-tooltip');
    if (!container || typeof d3 === 'undefined') return;

    // Clear previous graph if re-navigating
    container.innerHTML = '';

    var data;
    try {
      // Use cached graph data if available
      if (window._graphData) {
        data = window._graphData;
        buildGraph(container, tooltip, data);
      } else {
        fetch('/assets/data/graph-data.json').then(function(resp) {
          return resp.json();
        }).then(function(d) {
          data = d;
          window._graphData = d;
          buildGraph(container, tooltip, data);
        }).catch(function() {
          container.innerHTML = '<p style="padding:40px;color:var(--text-muted)">无法加载图谱数据</p>';
        });
      }
    } catch (e) {
      container.innerHTML = '<p style="padding:40px;color:var(--text-muted)">无法加载图谱数据</p>';
    }
  }

  function buildGraph(container, tooltip, data) {
    // Deep clone to avoid D3 mutation issues on re-render
    var nodes = data.nodes.map(function(n) { return Object.assign({}, n); });
    var edges = data.edges.map(function(e) { return { source: e.source, target: e.target }; });

    var width = container.clientWidth;
    var height = container.clientHeight || 600;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Zoom
    var g = svg.append('g');
    svg.call(d3.zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', function(event) { g.attr('transform', event.transform); }));

    // Force simulation
    var simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(function(d) { return d.id; })
        .distance(60))
      .force('charge', d3.forceManyBody().strength(-80))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(function(d) { return nodeRadius(d) + 2; }));

    // Links
    var link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'rgba(56,189,248,0.12)')
      .attr('stroke-width', 1);

    // Nodes
    var node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', function(d) { return nodeRadius(d); })
      .attr('fill', function(d) { return COLORS[d.category] || '#38BDF8'; })
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded));

    // Labels (only for high-ref nodes)
    var labels = g.append('g')
      .selectAll('text')
      .data(nodes.filter(function(d) { return d.refs > 1 || d.category === 'concept' || d.category === 'person'; }))
      .join('text')
      .text(function(d) { return d.title.substring(0, 8); })
      .attr('font-size', '7px')
      .attr('fill', 'rgba(240,244,255,0.6)')
      .attr('text-anchor', 'middle')
      .attr('dy', function(d) { return nodeRadius(d) + 10; })
      .style('pointer-events', 'none');

    // Tooltip
    node.on('mouseover', function(event, d) {
      tooltip.style.display = 'block';
      tooltip.innerHTML = '<strong>' + d.title + '</strong><br>' +
        '<span style="color:var(--text-muted)">' + (d.year || '') + ' · 引用 ' + d.refs + '</span>';
      tooltip.style.left = (event.clientX + 12) + 'px';
      tooltip.style.top = (event.clientY - 10) + 'px';
    })
    .on('mousemove', function(event) {
      tooltip.style.left = (event.clientX + 12) + 'px';
      tooltip.style.top = (event.clientY - 10) + 'px';
    })
    .on('mouseout', function() {
      tooltip.style.display = 'none';
    })
    .on('click', function(event, d) {
      // SPA navigation
      if (d.path && typeof window.Router !== 'undefined') {
        window.Router.navigate(d.path);
      } else if (d.path) {
        window.location.href = d.path;
      }
    });

    // Tick
    simulation.on('tick', function() {
      link
        .attr('x1', function(d) { return d.source.x; })
        .attr('y1', function(d) { return d.source.y; })
        .attr('x2', function(d) { return d.target.x; })
        .attr('y2', function(d) { return d.target.y; });
      node
        .attr('cx', function(d) { return d.x; })
        .attr('cy', function(d) { return d.y; });
      labels
        .attr('x', function(d) { return d.x; })
        .attr('y', function(d) { return d.y; });
    });

    function nodeRadius(d) {
      var base = 4;
      var refBonus = Math.min(d.refs * 1.5, 10);
      if (d.category === 'concept' || d.category === 'person') return base + 3 + refBonus;
      return base + refBonus;
    }

    function dragStarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragEnded(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Handle resize — remove previous handler to prevent duplicates
    if (window._graphResizeHandler) {
      window.removeEventListener('resize', window._graphResizeHandler);
    }
    var resizeHandler = function() {
      var w = container.clientWidth;
      var h = container.clientHeight || 600;
      svg.attr('width', w).attr('height', h).attr('viewBox', [0, 0, w, h]);
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    };
    window._graphResizeHandler = resizeHandler;
    window.addEventListener('resize', resizeHandler);
  }

  // Expose globally for app.js to call
  window.initGraph = initGraph;
})();
