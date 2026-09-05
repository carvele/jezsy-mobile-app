import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

type SuggestedUser = UserProfile & { mutual_count: number };

type SuggestedUser = UserProfile & { mutual_count: number };

type UserProfile = {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  
};

type Connection = {
  id: string;
  user_id_1: string;
  user_id_2: string;
  status: 'pending' | 'accepted' | 'blocked';
  action_user_id: string;
  other_user: UserProfile;
};

export default function NetworkScreen() {
  const { user } = useAuth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'connections' | 'pending' | 'search'>('connections');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [connections, setConnections] = useState<Connection[]>([]);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<SuggestedUser[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<SuggestedUser[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);

  useEffect(() => {
    if (user && (activeTab === 'connections' || activeTab === 'pending')) {
      loadConnections();
    }
    }, [user, activeTab]);

  const loadConnections = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch connections where user is involved
      const { data, error } = await supabase
        .from('connections')
        .select(`
          id, user_id_1, user_id_2, status, action_user_id
        `)
        .or(`user_id_1.eq.${user.id},user_id_2.eq.${user.id}`)
        .neq('status', 'blocked');

      if (error) throw error;

      // Manually join profiles because the RLS might restrict direct joins depending on how it's set up
      // Or we can just join profiles
      const formattedConnections = await Promise.all(
        (data || []).map(async (conn) => {
          const otherUserId = conn.user_id_1 === user.id ? conn.user_id_2 : conn.user_id_1;
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, username, first_name, last_name')
            .eq('id', otherUserId)
            .single();

          return {
            ...conn,
            other_user: profile || { id: otherUserId, username: 'Unknown', first_name: '', last_name: '' }
          } as Connection;
        })
      );

      setConnections(formattedConnections);
    } catch (err: any) { console.log(err);
      console.log('Error loading connections:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !user) return;
    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, first_name, last_name')
        .or(`username.ilike.%${searchQuery.trim()}%,first_name.ilike.%${searchQuery.trim()}%,last_name.ilike.%${searchQuery.trim()}%`)
        .neq('id', user.id)
        .limit(20);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (err: any) { console.log(err);
      console.log('Error searching users:', err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleConnect = async (otherUserId: string) => {
    if (!user) return;
    try {
      const u1 = user.id < otherUserId ? user.id : otherUserId;
      const u2 = user.id < otherUserId ? otherUserId : user.id;

      const { error } = await supabase
        .from('connections')
        .insert({
          user_id_1: u1,
          user_id_2: u2,
          status: 'pending',
          action_user_id: user.id
        });

      if (error) {
        if (error.code === '23505') {
          showToast('Connection already exists', 'error');
        } else {
          throw error;
        }
      } else {
        showToast('Request sent', 'success');
        if (activeTab !== 'search') loadConnections();
      }
    } catch (err: any) { console.log(err);
      showToast('Failed to send request', 'error');
    }
  };

  const handleAccept = async (connectionId: string, u1: string, u2: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('connections')
        .update({
          status: 'accepted',
          action_user_id: user.id
        })
        .eq('user_id_1', u1)
        .eq('user_id_2', u2);

      if (error) throw error;
      showToast('Request accepted', 'success');
      loadConnections();
    } catch (err: any) { console.log(err);
      showToast('Failed to accept request', 'error');
    }
  };

  const handleBlock = async (u1: string, u2: string) => {
    if (!user) return;
    try {
      // Upsert block
      const { error } = await supabase
        .from('connections')
        .upsert({
          user_id_1: u1,
          user_id_2: u2,
          status: 'blocked',
          action_user_id: user.id
        });

      if (error) throw error;
      showToast('User blocked', 'success');
      if (activeTab !== 'search') loadConnections();
    } catch (err: any) { console.log(err);
      showToast('Failed to block user', 'error');
    }
  };

  const renderConnectionItem = ({ item }: { item: Connection }) => (
    <TouchableOpacity 
      style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push(`/user/${item.other_user.id}` as any)}
    >
      <View style={[styles.avatar, { backgroundColor: colors.border }]}>
        {false ? (
          <Image source={{ uri: '' }} style={styles.avatarImage} />
        ) : (
          <IconSymbol name="person.fill" size={24} color={colors.secondaryText} />
        )}
      </View>
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.text }]}>@{item.other_user.username}</Text>
        <Text style={[styles.userFullName, { color: colors.secondaryText }]}>
          {item.other_user.first_name} {item.other_user.last_name}
        </Text>
      </View>

      {item.status === 'pending' && item.action_user_id !== user?.id && (
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: colors.tint }]}
          onPress={(e) => { e.stopPropagation(); handleAccept(item.id, item.user_id_1, item.user_id_2); }}
        >
          <Text style={styles.actionBtnText}>Accept</Text>
        </TouchableOpacity>
      )}
      
      {item.status === 'pending' && item.action_user_id === user?.id && (
        <View style={[styles.actionBtn, { backgroundColor: colors.border }]}>
          <Text style={[styles.actionBtnText, { color: colors.text }]}>Sent</Text>
        </View>
      )}

      {item.status === 'accepted' && (
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: colors.border }]}
          onPress={(e) => { e.stopPropagation(); router.push(`/chat/${item.other_user.id}` as any); }}
        >
          <Text style={[styles.actionBtnText, { color: colors.text }]}>Message</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderSearchItem = ({ item }: { item: UserProfile }) => {
    // Check if we already have a connection
    const existing = connections.find(c => c.other_user.id === item.id);
    
    return (
      <TouchableOpacity 
        style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => router.push(`/user/${item.id}` as any)}
      >
        <View style={[styles.avatar, { backgroundColor: colors.border }]}>
          {false ? (
            <Image source={{ uri: '' }} style={styles.avatarImage} />
          ) : (
            <IconSymbol name="person.fill" size={24} color={colors.secondaryText} />
          )}
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>@{item.username}</Text>
          <Text style={[styles.userFullName, { color: colors.secondaryText }]}>
            {item.first_name} {item.last_name}
          </Text>
        </View>

        {!existing ? (
          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: colors.tint }]}
            onPress={(e) => { e.stopPropagation(); handleConnect(item.id); }}
          >
            <Text style={styles.actionBtnText}>Connect</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.actionBtn, { backgroundColor: colors.border }]}>
            <Text style={[styles.actionBtnText, { color: colors.text }]}>
              {existing.status === 'pending' ? 'Pending' : existing.status}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const getFilteredConnections = () => {
    if (activeTab === 'connections') {
      return connections.filter(c => c.status === 'accepted');
    }
    if (activeTab === 'pending') {
      return connections.filter(c => c.status === 'pending');
    }
    return [];
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Network</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        {(['connections', 'pending', 'search'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.tint }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[
              styles.tabText, 
              { color: activeTab === tab ? colors.tint : colors.secondaryText },
              activeTab === tab && { fontWeight: '600' }
            ]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'search' && (
        <View style={styles.searchContainer}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface }]}>
            <IconSymbol name="magnifyingglass" size={20} color={colors.secondaryText} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by username..."
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      )}

      {loading && activeTab !== 'search' ? (
        <ActivityIndicator color={colors.tint} style={{ marginTop: 40 }} />
      ) : activeTab === 'search' ? (
        <FlatList
          data={searchResults}
          renderItem={renderSearchItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              {searchLoading ? 'Searching...' : (searchQuery ? 'No users found' : 'Search for users to connect')}
            </Text>
          }
        />
      ) : (
        <FlatList
          data={getFilteredConnections()}
          renderItem={renderConnectionItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              No {activeTab} found.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    ...Type.body,
  },
  searchContainer: {
    padding: Spacing.lg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    ...Type.body,
  },
  list: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: Spacing.md,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    ...Type.bodyLarge,
    fontWeight: '600',
  },
  userFullName: {
    ...Type.caption,
    marginTop: 2,
  },
  actionBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  actionBtnText: {
    ...Type.caption,
    fontWeight: '600',
    color: '#fff',
  },
  sectionTitle: {
    ...Type.title,
    fontSize: 18,
    marginBottom: Spacing.md,
    marginLeft: Spacing.md,
  },
  sectionTitle: {
    ...Type.title,
    fontSize: 18,
    marginBottom: Spacing.md,
    marginLeft: Spacing.md,
  },
  emptyText: {
    ...Type.body,
    textAlign: 'center',
    marginTop: 40,
  }
});
