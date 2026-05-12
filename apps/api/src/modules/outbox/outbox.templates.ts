export const BASE_REPORT_STYLE = `<style>
    body {
      margin: 0;
      background: linear-gradient(180deg, #edf3fb 0%, #f6f8fc 100%);
      font-family: Segoe UI, Arial, sans-serif;
      color: #1f2937;
    }
    .shell {
      max-width: 1280px;
      margin: 28px auto;
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #d4d7dd;
      box-shadow: 0 10px 28px rgba(4, 30, 66, 0.14);
      overflow: hidden;
    }
    .top-strip {
      height: 10px;
      background-color: #ffc300;
      background: linear-gradient(90deg, #ffc300 0%, #ffd95c 100%);
    }
    .hero {
      background-color: #002b5c;
      background: #002b5c;
      background: linear-gradient(120deg, #002b5c 0%, #0057a4 100%);
      color: #ffffff;
      padding: 20px 26px;
      border-bottom: 1px solid #00244a;
    }
    .hero-title {
      margin: 0;
      font-size: 24px;
      line-height: 1.25;
      font-weight: 800;
    }
    .hero-highlight {
      color: #ffd000;
    }
    .hero-subtitle {
      margin-top: 6px;
      color: #dde9ff;
      font-size: 12px;
      line-height: 1.5;
    }
    .hero-period-pill {
      display: inline-block;
      margin-top: 10px;
      background: #ffd000;
      color: #002b5c;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.3px;
      padding: 5px 12px;
      border-radius: 999px;
      border: 1px solid #ffbe0b;
      text-transform: uppercase;
    }
    .body-wrap {
      padding: 22px 26px;
      font-size: 14px;
      line-height: 1.65;
    }
    .intro-note {
      margin: 0 0 12px 0;
      font-size: 12px;
      color: #46556a;
      line-height: 1.55;
      background: #f8fbff;
      border: 1px solid #d4d7dd;
      border-left: 4px solid #0057a4;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .panel {
      margin: 12px 0 16px 0;
      padding: 14px 16px;
      background: #f8fafc;
      border: 1px solid #d4d7dd;
      border-radius: 14px;
    }
    .panel-warm {
      background: #fffbef;
      border-color: #f0df9e;
    }
    .period-banner {
      margin: 0 0 12px 0;
      background: #002b5c;
      color: #ffffff;
      border: 1px solid #001f42;
      border-left: 6px solid #ffd000;
      border-radius: 12px;
      padding: 11px 12px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .quick-access {
      margin: 0 0 14px 0;
      background: linear-gradient(120deg, #eef6ff 0%, #f7fbff 100%);
      border: 1px solid #cfe0f5;
      border-radius: 12px;
      padding: 12px;
    }
    .quick-access-title {
      margin: 0 0 2px 0;
      font-size: 12px;
      font-weight: 800;
      color: #0a3e74;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      text-align: center;
    }
    .quick-access-text {
      margin: 0 0 10px 0;
      font-size: 12px;
      color: #46556a;
      line-height: 1.45;
      text-align: center;
    }
    .quick-access-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: center;
    }
    .quick-access .cta-btn {
      margin: 0;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #0057a4;
      margin: 0 0 8px 0;
      letter-spacing: 0.2px;
    }
    .kpi-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 8px 0 10px 0;
    }
    .kpi {
      flex: 1 1 150px;
      background: #ffffff;
      border: 1px solid #d4d7dd;
      border-radius: 12px;
      padding: 10px 12px;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.04);
    }
    .kpi-success {
      background: #dcfce7;
      border-color: #cce8d6;
    }
    .kpi-info {
      background: #dbeafe;
      border-color: #c3d9fb;
    }
    .kpi-warning {
      background: #ffedd5;
      border-color: #f3c9a0;
    }
    .kpi-danger {
      background: #fee2e2;
      border-color: #f2c7cf;
    }
    .kpi-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      color: #5c6c82;
      margin-bottom: 2px;
    }
    .kpi-value {
      font-size: 22px;
      line-height: 1.2;
      font-weight: 800;
      color: #002b5c;
    }
    .kpi-meta {
      font-size: 11px;
      color: #5c6c82;
    }
    .score-bar-wrap {
      margin-top: 10px;
      background: #ffffff;
      border: 1px solid #d4d7dd;
      border-radius: 12px;
      padding: 10px 10px 8px 10px;
    }
    .score-bar-title {
      margin: 0 0 8px 0;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      color: #5c6c82;
    }
    .score-bar {
      width: 100%;
      height: 20px;
      background: #e8edf5;
      border-radius: 999px;
      overflow: hidden;
      display: flex;
    }
    .score-seg {
      height: 100%;
      font-size: 10px;
      font-weight: 800;
      line-height: 20px;
      text-align: center;
      white-space: nowrap;
    }
    .seg-exc {
      background: #22c55e;
      color: #073b18;
    }
    .seg-good {
      background: #60a5fa;
      color: #0b3b73;
    }
    .seg-ok {
      background: #f59e0b;
      color: #5f3b00;
    }
    .seg-bad {
      background: #ef4444;
      color: #5d1010;
    }
    .score-legend {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 11px;
      color: #334155;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid #d9e1ec;
      border-radius: 999px;
      padding: 2px 8px;
      background: #f8fbff;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot-exc { background: #22c55e; }
    .dot-good { background: #60a5fa; }
    .dot-ok { background: #f59e0b; }
    .dot-bad { background: #ef4444; }
    .table-container {
      border: 1px solid #d4d7dd;
      border-radius: 12px;
      overflow-x: auto;
      background: #ffffff;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
    }
    .report-table th {
      background: #0057a4;
      color: #ffffff;
      padding: 10px 8px;
      text-align: left;
      letter-spacing: 0.35px;
      text-transform: uppercase;
      font-size: 11px;
      line-height: 1.35;
    }
    .report-table td {
      padding: 10px 8px;
      border-top: 1px solid #e4e9f1;
      vertical-align: top;
      line-height: 1.45;
      color: #1f2937;
    }
    .report-table tbody tr:nth-child(even) {
      background: #f8fbff;
    }
    .obs-list {
      margin: 8px 0 0 0;
      padding-left: 18px;
      color: #25364d;
      font-size: 13px;
      line-height: 1.55;
    }
    .obs-list li {
      margin-bottom: 6px;
    }
    .cta-wrap {
      text-align: center;
      margin-top: 14px;
    }
    .cta-btn {
      display: inline-block;
      background: #ffd000;
      color: #002b5c;
      text-decoration: none;
      padding: 14px 26px;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 800;
      border: 2px solid #ffc300;
      box-shadow: 0 5px 12px rgba(0, 0, 0, 0.2);
      margin: 0 6px 10px 6px;
    }
    .cta-btn.alt {
      background: #ffffff;
      color: #0057a4;
      border-color: #0057a4;
      box-shadow: none;
    }
    .action-panel {
      margin-top: 12px;
      border: 1px solid #d8e2ef;
      border-radius: 12px;
      padding: 12px;
      background: #f8fbff;
      text-align: center;
    }
    .action-title {
      margin: 0 0 6px 0;
      font-size: 12px;
      font-weight: 800;
      color: #0a3e74;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .action-text {
      margin: 0 0 10px 0;
      font-size: 12px;
      color: #4b5c73;
      line-height: 1.45;
    }
    .report-footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #e4e9f1;
      color: #556175;
      font-size: 12px;
      text-align: right;
    }
  </style>`;
