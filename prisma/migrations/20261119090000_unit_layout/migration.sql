-- AlterTable
ALTER TABLE "units" ADD COLUMN     "layout_d" DECIMAL(7,2),
ADD COLUMN     "layout_w" DECIMAL(7,2),
ADD COLUMN     "layout_x" DECIMAL(7,2),
ADD COLUMN     "layout_y" DECIMAL(7,2);


-- المخطط: إما كل القيم أو لا شيء، وبحدود منطقية (أمتار)
ALTER TABLE units ADD CONSTRAINT units_layout_complete CHECK (
  num_nonnulls(layout_x, layout_y, layout_w, layout_d) IN (0, 4)
);
ALTER TABLE units ADD CONSTRAINT units_layout_bounds CHECK (
  layout_x IS NULL OR (layout_x BETWEEN 0 AND 500 AND layout_y BETWEEN 0 AND 500 AND layout_w BETWEEN 1 AND 100 AND layout_d BETWEEN 1 AND 100)
);
