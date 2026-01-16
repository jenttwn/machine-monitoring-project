// admin.gs - Cloudflare Tunnel Version

function doGet(e) {
  var newUrl = e.parameter.tunnel_url;
  var props = PropertiesService.getScriptProperties();
  
  if (newUrl) {
    props.setProperty('TUNNEL_BASE_URL', newUrl);
    props.setProperty('LAST_UPDATE', new Date().toISOString());
    
    return ContentService.createTextOutput("✅ Updated Success! New Cloudflare Tunnel URL: " + newUrl);
  } else {
    // แสดงสถานะปัจจุบัน
    var currentUrl = props.getProperty('TUNNEL_BASE_URL');
    var lastUpdate = props.getProperty('LAST_UPDATE');
    
    if (currentUrl) {
      var output = "📡 Cloudflare Tunnel Status\n\n";
      output += "URL: " + currentUrl + "\n";
      output += "Last Updated: " + (lastUpdate || "Unknown") + "\n";
      output += "Status: ✅ ACTIVE";
      return ContentService.createTextOutput(output);
    } else {
      return ContentService.createTextOutput("⚠️ No Cloudflare Tunnel URL set yet.");
    }
  }
}

// ฟังก์ชันให้ status.gs เรียกใช้
function getBaseUrl() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('TUNNEL_BASE_URL');
  
  if (!url) return "URL_NOT_SET";
  return url;
}

// ฟังก์ชันดูข้อมูล Cloudflare Tunnel ปัจจุบัน
function getCurrentTunnelInfo() {
  var props = PropertiesService.getScriptProperties();
  var url = getBaseUrl();
  var lastUpdate = props.getProperty('LAST_UPDATE');
  
  Logger.log("📡 Current Cloudflare Tunnel URL: " + url);
  Logger.log("🕐 Last Updated: " + (lastUpdate || "Unknown"));
  Logger.log("📝 URL is " + (url === "URL_NOT_SET" ? "NOT SET" : "ACTIVE"));
  
  return {
    url: url,
    lastUpdate: lastUpdate,
    isSet: url !== "URL_NOT_SET",
    urlLength: url.length
  };
}

// ฟังก์ชันดูข้อมูลทั้งหมดใน Properties
function debugProperties() {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  
  Logger.log("🔍 All Script Properties:");
  for (var key in allProps) {
    Logger.log("  - " + key + ": " + allProps[key].substring(0, 50) + (allProps[key].length > 50 ? "..." : ""));
  }
}

// ฟังก์ชันรีเซ็ต URL
function resetTunnelUrl() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('TUNNEL_BASE_URL');
  props.deleteProperty('LAST_UPDATE');
  Logger.log("🗑️ Cloudflare Tunnel URL has been reset");
}

// ฟังก์ชันอัพเดท URL แบบ manual
function setTunnelUrlManual(url) {
  if (!url) {
    Logger.log("❌ Error: Please provide a URL");
    Logger.log("Usage: setTunnelUrlManual('https://your-url.trycloudflare.com')");
    return;
  }
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty('TUNNEL_BASE_URL', url);
  props.setProperty('LAST_UPDATE', new Date().toISOString());
  
  Logger.log("✅ Cloudflare Tunnel URL updated manually: " + url);
}

// ฟังก์ชันทดสอบการเชื่อมต่อ Cloudflare Tunnel
function testCloudflareConnection() {
  var tunnelUrl = getBaseUrl();
  
  if (tunnelUrl === "URL_NOT_SET") {
    Logger.log("❌ Error: Cloudflare Tunnel URL not set");
    return;
  }
  
  Logger.log("🧪 Testing Cloudflare Tunnel connection...");
  Logger.log("📡 Tunnel URL: " + tunnelUrl);
  
  try {
    var testUrl = tunnelUrl + "/health";
    var response = UrlFetchApp.fetch(testUrl, {
      "method": "GET",
      "muteHttpExceptions": true
    });
    
    var statusCode = response.getResponseCode();
    var content = response.getContentText();
    
    Logger.log("✅ Status: " + statusCode);
    Logger.log("📄 Response: " + content.substring(0, 200));
    
    if (statusCode === 200) {
      Logger.log("✅ Cloudflare Tunnel connection OK!");
    } else {
      Logger.log("⚠️ Unexpected status code: " + statusCode);
    }
  } catch (e) {
    Logger.log("❌ Connection error: " + e.toString());
  }
}



