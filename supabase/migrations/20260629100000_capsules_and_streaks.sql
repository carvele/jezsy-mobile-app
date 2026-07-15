-- Capsules Table
CREATE TABLE capsules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    target_count INTEGER DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Capsule Items Link Table
CREATE TABLE capsule_items (
    capsule_id UUID NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,
    wardrobe_item_id UUID NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (capsule_id, wardrobe_item_id)
);

-- Gamified Streaks Table
CREATE TABLE user_streaks (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_action_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE capsules ENABLE ROW LEVEL SECURITY;
ALTER TABLE capsule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own capsules" ON capsules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own capsules" ON capsules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own capsules" ON capsules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own capsules" ON capsules FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own capsule items" ON capsule_items FOR SELECT USING (
    capsule_id IN (SELECT id FROM capsules WHERE user_id = auth.uid())
);
CREATE POLICY "Users can insert own capsule items" ON capsule_items FOR INSERT WITH CHECK (
    capsule_id IN (SELECT id FROM capsules WHERE user_id = auth.uid())
);
CREATE POLICY "Users can delete own capsule items" ON capsule_items FOR DELETE USING (
    capsule_id IN (SELECT id FROM capsules WHERE user_id = auth.uid())
);

CREATE POLICY "Users can view own streaks" ON user_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own streaks" ON user_streaks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own streaks" ON user_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to handle streaks logic (to be called from frontend or trigger)
CREATE OR REPLACE FUNCTION update_user_streak(p_user_id UUID)
RETURNS void AS $$
DECLARE
    v_streak user_streaks%ROWTYPE;
    v_today DATE := CURRENT_DATE;
BEGIN
    SELECT * INTO v_streak FROM user_streaks WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        -- First action ever
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_action_date)
        VALUES (p_user_id, 1, 1, v_today);
    ELSE
        -- Prevent multi-increment on same day
        IF v_streak.last_action_date = v_today THEN
            RETURN;
        ELSIF v_streak.last_action_date = v_today - INTERVAL '1 day' THEN
            -- Consecutive day
            UPDATE user_streaks SET 
                current_streak = current_streak + 1,
                longest_streak = GREATEST(longest_streak, current_streak + 1),
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = p_user_id;
        ELSE
            -- Streak broken
            UPDATE user_streaks SET 
                current_streak = 1,
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = p_user_id;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
