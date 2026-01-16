// status.gs - Cloudflare Tunnel Version

function fetchAllMachinesRunning(customYear, customMonth) {
  var startTime = new Date();
  
  var machines = getMachines(); 
  var tunnelBaseUrl = getBaseUrl();
  
  if (tunnelBaseUrl === "URL_NOT_SET") {
    Logger.log("❌ Error: Cloudflare Tunnel URL has not been set yet.");
    return;
  }
  
  Logger.log("📡 Using Cloudflare Tunnel URL: " + tunnelBaseUrl);
  
  var today = new Date();
  
  // Parse year และ month อย่างปลอดภัย
  var year = customYear ? parseInt(customYear, 10) : today.getFullYear();
  var month = customMonth ? parseInt(customMonth, 10) : today.getMonth() + 1;
  
  // ถ้า parse ไม่ได้ (NaN) ให้ใช้ค่าปัจจุบัน
  if (isNaN(year)) {
    year = today.getFullYear();
  }
  if (isNaN(month)) {
    month = today.getMonth() + 1;
  }
  
  var mm = (month < 10 ? "0" : "") + month;
  var yy = String(year).substr(-2);
  var sheetName = mm + yy + "_Status";
  
  Logger.log("📅 Sheet: " + sheetName + " (Year: " + year + ", Month: " + month + ")");
  var currentDateTime = new Date();

  // จัดกลุ่มเครื่องจักรตาม Floor
  var machinesByFloor = {};
  machines.forEach(function(machine) {
    var floor = machine.floor || "floor1";
    if (!machinesByFloor[floor]) {
      machinesByFloor[floor] = [];
    }
    machinesByFloor[floor].push(machine);
  });

  var floorNames = Object.keys(machinesByFloor).sort();
  Logger.log("🏢 Floors: " + floorNames.join(", "));

  var allDataRows = [];

  // ประมวลผลแต่ละ Floor
  floorNames.forEach(function(floorName) {
    var floorMachines = machinesByFloor[floorName];
    Logger.log("🔄 Processing " + floorName + " (" + floorMachines.length + " machines)");
    
    var floorHeader = ["", floorName.toUpperCase() + " (" + floorMachines.length + " machines)"];
    for (var i = 0; i < 31; i++) { floorHeader.push(""); }
    allDataRows.push(floorHeader);
    
    var floorData = processFloorOptimized(floorName, floorMachines, tunnelBaseUrl, year, month, currentDateTime);
    allDataRows = allDataRows.concat(floorData);
    
    var emptyRow = new Array(33).fill("");
    allDataRows.push(emptyRow);
  });

  // บันทึกข้อมูล
  try {
    saveToSheetBatch(sheetName, allDataRows);
    
    var endTime = new Date();
    var duration = Math.round((endTime - startTime) / 1000);
    Logger.log("✅ Completed in " + duration + " seconds");
    Logger.log("📊 Total: " + machines.length + " machines processed");
  } catch (saveErr) {
    Logger.log("❌ Error saving: " + saveErr.toString());
  }
}

// ฟังก์ชันที่ optimize แล้ว - ลด batch size และเพิ่ม retry
function processFloorOptimized(floorName, machines, tunnelBaseUrl, year, month, currentDateTime) {
  var floorDataRows = [];
  var BATCH_SIZE = 25;
  var MAX_RETRIES = 2;
  var totalBatches = Math.ceil(machines.length / BATCH_SIZE);
  
  Logger.log("  → Processing in " + totalBatches + " batches (size: " + BATCH_SIZE + ")");

  for (var batchNum = 0; batchNum < totalBatches; batchNum++) {
    var startIdx = batchNum * BATCH_SIZE;
    var endIdx = Math.min(startIdx + BATCH_SIZE, machines.length);
    var batchMachines = machines.slice(startIdx, endIdx);
    
    Logger.log("  → Batch " + (batchNum + 1) + "/" + totalBatches + " (Machines " + (startIdx + 1) + "-" + endIdx + ")");
    
    var batchSuccess = false;
    var retryCount = 0;
    
    // ลองส่ง request ใหม่ถ้าล้ม
    while (!batchSuccess && retryCount <= MAX_RETRIES) {
      try {
        var requests = batchMachines.map(function(machine, idx) {
          var floorPrefix = "/" + floorName;
          var fullUrl = tunnelBaseUrl + floorPrefix + "/v2/signals/" + machine.id + 
                        "/monthly_operation_graph?scope=workTime&year=" + year + "&month=" + month;
          
          return {
            "url": fullUrl,
            "method": "GET",
            "headers": {
              "accept": "application/json",
              "User-Agent": "GoogleAppsScript/1.0",
              "Connection": "keep-alive"
            },
            "followRedirects": true,
            "muteHttpExceptions": true,
            "validateHttpsCertificates": false
          };
        });

        var responses = UrlFetchApp.fetchAll(requests);
        
        // Log สำหรับ debug
        Logger.log("  → Batch " + (batchNum + 1) + " received " + responses.length + " responses");
        
        // ประมวลผล responses
        responses.forEach(function(response, index) {
          var machine = batchMachines[index];
          var machineName = "ID: " + machine.id;
          var dailyRates = new Array(31).fill("");
          var statusCode = response.getResponseCode();
          
          // Log แต่ละ response
          if (statusCode !== 200) {
            Logger.log("    ⚠️ Machine " + machine.id + ": HTTP " + statusCode);
          }
          
          if (statusCode === 200) {
            try {
              var responseText = response.getContentText();
              
              // ตรวจสอบ error page
              if (responseText.indexOf('<!DOCTYPE') !== -1 || 
                  responseText.indexOf('<html') !== -1) {
                dailyRates[0] = "Error: HTML response";
                floorDataRows.push([currentDateTime, machineName].concat(dailyRates));
                return;
              }
              
              var trimmedResponse = responseText.trim();
              if (trimmedResponse.charAt(0) !== '{' && trimmedResponse.charAt(0) !== '[') {
                dailyRates[0] = "Error: Invalid format";
                floorDataRows.push([currentDateTime, machineName].concat(dailyRates));
                return;
              }
              
              var jsonData = JSON.parse(trimmedResponse);

              // ดึงชื่อจริง
              if (jsonData.data && jsonData.data.signalName) {
                machineName = jsonData.data.signalName;
              }

              // ประมวลผลข้อมูลรายวัน
              if (jsonData.data && jsonData.data.days && Array.isArray(jsonData.data.days)) {
                jsonData.data.days.forEach(function(dayRecord) {
                  if (!dayRecord || typeof dayRecord.day === 'undefined') return;
                  
                  var dayIndex = dayRecord.day - 1;
                  if (dayIndex >= 0 && dayIndex < 31) {
                    var runningDuration = 0;
                    var totalTime = 0;
                    
                    if (dayRecord.totals && Array.isArray(dayRecord.totals)) {
                      dayRecord.totals.forEach(function(t) {
                        if (t && typeof t.duration !== 'undefined') {
                          if (t.number === 9) runningDuration = t.duration;
                          totalTime += t.duration;
                        }
                      });
                    }
                    
                    var rate = 0;
                    if (runningDuration > 0 && totalTime > 0) {
                      rate = (runningDuration / totalTime) * 100;
                    }
                    dailyRates[dayIndex] = rate.toFixed(2) + "%";
                  }
                });
              } else {
                dailyRates[0] = "No data";
              }
              
            } catch (err) {
              dailyRates[0] = "Error: " + err.message.substring(0, 30);
            }
          } else if (statusCode === 503 || statusCode === 502) {
            dailyRates[0] = "Error: Server down";
          } else if (statusCode === 404) {
            dailyRates[0] = "Error: Not found";
          } else if (statusCode === 400) {
            // Log response body สำหรับ 400
            var errorBody = response.getContentText().substring(0, 100);
            Logger.log("    ❌ Machine " + machine.id + " - 400 Error: " + errorBody);
            dailyRates[0] = "Error: Bad request";
          } else {
            dailyRates[0] = "Error: HTTP " + statusCode;
          }

          var rowData = [currentDateTime, machineName].concat(dailyRates);
          floorDataRows.push(rowData);
        });
        
        batchSuccess = true;
        
        // Delay ระหว่าง batch
        if (batchNum < totalBatches - 1) {
          Logger.log("  ⏳ Waiting 8 seconds...");
          Utilities.sleep(8000);
        }
        
      } catch (batchErr) {
        retryCount++;
        Logger.log("  ❌ Batch error (attempt " + retryCount + "/" + (MAX_RETRIES + 1) + "): " + batchErr.toString());
        
        if (retryCount <= MAX_RETRIES) {
          Logger.log("  🔄 Retrying in 10 seconds...");
          Utilities.sleep(10000);
        } else {
          // ล้มเหลวหมดแล้ว - สร้างแถว error
          Logger.log("  ❌ Batch failed after all retries");
          batchMachines.forEach(function(machine) {
            var machineName = "ID: " + machine.id;
            var dailyRates = new Array(31).fill("");
            dailyRates[0] = "Error: Batch failed";
            floorDataRows.push([currentDateTime, machineName].concat(dailyRates));
          });
        }
      }
    }
  }

  Logger.log("  ✅ " + floorName + " done: " + floorDataRows.length + " rows");
  return floorDataRows;
}

function fetchYearSelected() {
  fetchAllMachinesRunning(2025, 12);
}

// ฟังก์ชันทดสอบความเร็ว
function testSpeed() {
  var tunnelBaseUrl = getBaseUrl();
  var testUrl = tunnelBaseUrl + "/health";
  
  Logger.log("🧪 Testing speed to: " + testUrl);
  
  var times = [];
  for (var i = 0; i < 3; i++) {
    var start = new Date();
    try {
      var response = UrlFetchApp.fetch(testUrl, {
        "method": "GET",
        "muteHttpExceptions": true
      });
      var end = new Date();
      var duration = end - start;
      times.push(duration);
      Logger.log("Test " + (i+1) + ": " + duration + "ms");
    } catch (e) {
      Logger.log("Test " + (i+1) + ": Failed - " + e.toString());
    }
    
    if (i < 2) Utilities.sleep(1000);
  }
  
  if (times.length > 0) {
    var avg = times.reduce(function(a, b) { return a + b; }) / times.length;
    Logger.log("Average: " + Math.round(avg) + "ms");
    
    if (avg > 3000) {
      Logger.log("⚠️ Connection is SLOW (>3s)");
    } else if (avg > 1000) {
      Logger.log("⚠️ Connection is MEDIUM (1-3s)");
    } else {
      Logger.log("✅ Connection is FAST (<1s)");
    }
  }
}

function testCloudflareConnection() {
  var tunnelBaseUrl = getBaseUrl();
  if (tunnelBaseUrl === "URL_NOT_SET") {
    Logger.log("❌ Error: Cloudflare Tunnel URL not set");
    return;
  }
  
  Logger.log("🧪 Testing Cloudflare Tunnel connection...");
  Logger.log("📡 Tunnel URL: " + tunnelBaseUrl);
  
  var testUrl = tunnelBaseUrl + "/health";
  
  try {
    var response = UrlFetchApp.fetch(testUrl, {
      "method": "GET",
      "muteHttpExceptions": true
    });
    
    var statusCode = response.getResponseCode();
    var content = response.getContentText();
    
    Logger.log("✅ Status: " + statusCode);
    Logger.log("📄 Response: " + content.substring(0, 200));
    
    if (statusCode === 200) {
      Logger.log("✅ Connection OK!");
      
      // ทดสอบ floor1
      var floor1Url = tunnelBaseUrl + "/floor1/v2/signals";
      var floor1Response = UrlFetchApp.fetch(floor1Url, {
        "method": "GET",
        "muteHttpExceptions": true
      });
      
      Logger.log("✅ Floor1: " + floor1Response.getResponseCode());
    }
  } catch (e) {
    Logger.log("❌ Error: " + e.toString());
  }
}

function saveToSheetBatch(sheetName, allRowsData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log("📝 Creating sheet: " + sheetName);
    sheet = ss.insertSheet(sheetName);
    var headers = ["Last Updated", "Machine Name"];
    for (var i = 1; i <= 31; i++) { headers.push("D" + i); }
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, 33).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenColumns(2);
    sheet.setFrozenRows(1);
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow()-1, 33).clearContent();
  }

  if (allRowsData.length > 0) {
    Logger.log("💾 Saving " + allRowsData.length + " rows...");
    sheet.getRange(2, 1, allRowsData.length, allRowsData[0].length).setValues(allRowsData);
    
    for (var i = 0; i < allRowsData.length; i++) {
      if (allRowsData[i][0] instanceof Date) {
        sheet.getRange(i + 2, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");
      } else if (allRowsData[i][1] && allRowsData[i][1].toString().indexOf("(") > -1) {
        sheet.getRange(i + 2, 1, 1, 33).setFontWeight("bold").setBackground("#fce5cd");
      }
    }
  }
  
  Logger.log("✅ Saved to: " + sheetName);
}