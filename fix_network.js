const fs = require('fs');
let c = fs.readFileSync('app/(tabs)/profile.tsx', 'utf8');

const correctSection = `<View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Shopping & Social</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
              {renderSettingItem(
                  'heart.fill',
                  'Wishlist',
                  \`\${wishlistIds.size} saved items\`,
                  () => router.push('/wishlist' as any),
                )}
              {renderSettingItem(
                  'person.2.fill',
                  'My Network',
                  'Find and connect with friends',
                  () => router.push('/network' as any),
                )}
              {renderSettingItem(
                  'lock.fill',
                  'Privacy Settings',
                  'Wardrobe sharing',
                  () => router.push('/profile/privacy-settings' as any),
                )}
                {renderSettingItem(
                  'square.and.arrow.up',
                  'Share My Profile',
                  'Send link to friends',
                  handleShareProfile,
                )}
            </View>
          </View>`;

c = c.replace(/<View style=\{styles\.section\}>\s*<Text style=\{.*?>Shopping & Wardrobe<\/Text>\s*<View style=\{.*?>[\s\S]*?<\/View>\s*<\/View>/, correctSection);

fs.writeFileSync('app/(tabs)/profile.tsx', c);
