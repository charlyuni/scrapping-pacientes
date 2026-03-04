-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "asl" TEXT NOT NULL,
    "hospital" TEXT NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "rawHtml" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricRow" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,

    CONSTRAINT "MetricRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricCell" (
    "id" TEXT NOT NULL,
    "metricRowId" TEXT NOT NULL,
    "colorCode" TEXT NOT NULL,
    "valueString" TEXT NOT NULL,
    "valueNumber" INTEGER,
    "valueMinutes" DOUBLE PRECISION,

    CONSTRAINT "MetricCell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Facility_asl_hospital_key" ON "Facility"("asl", "hospital");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_facilityId_hourBucket_key" ON "Snapshot"("facilityId", "hourBucket");

-- CreateIndex
CREATE INDEX "Snapshot_capturedAt_idx" ON "Snapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricRow_snapshotId_metricName_key" ON "MetricRow"("snapshotId", "metricName");

-- CreateIndex
CREATE UNIQUE INDEX "MetricCell_metricRowId_colorCode_key" ON "MetricCell"("metricRowId", "colorCode");

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricRow" ADD CONSTRAINT "MetricRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricCell" ADD CONSTRAINT "MetricCell_metricRowId_fkey" FOREIGN KEY ("metricRowId") REFERENCES "MetricRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
