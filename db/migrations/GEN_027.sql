-- GEN_027: Device Purchase Orders, Platform Settings, and Meter Link Requests

-- device_orders table
CREATE TABLE device_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(15,2) NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL,
  delivery_address TEXT NOT NULL,
  receipt_path TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'pending_approval', 'approved', 'rejected', 'shipped', 'delivered')),
  rejection_reason TEXT,
  notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- platform_settings table (for GEN CORE unit price)
CREATE TABLE platform_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO platform_settings (key, value) VALUES ('gen_core_unit_price', '{"amount": 0, "currency": "MYR"}');

-- meter_link_requests table
CREATE TABLE meter_link_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES meters(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_device_orders_user_id ON device_orders(user_id);
CREATE INDEX idx_device_orders_status ON device_orders(status);
CREATE INDEX idx_meter_link_requests_status ON meter_link_requests(status);
CREATE INDEX idx_meter_link_requests_requested_by ON meter_link_requests(requested_by);
