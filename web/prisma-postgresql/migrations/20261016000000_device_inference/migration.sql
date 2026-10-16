CREATE TABLE "DeviceInference" (
 "id" TEXT NOT NULL PRIMARY KEY, "runId" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "requestJson" TEXT NOT NULL, "responseJson" TEXT, "error" TEXT, "status" TEXT NOT NULL DEFAULT 'pending', "leaseTokenHash" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DeviceInference_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DeviceInference_deviceId_status_expiresAt_idx" ON "DeviceInference"("deviceId", "status", "expiresAt");
CREATE INDEX "DeviceInference_runId_idx" ON "DeviceInference"("runId");
