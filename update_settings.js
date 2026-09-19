const fs = require('fs');

let content = fs.readFileSync('app/reservations/[id].tsx', 'utf8');

const stateBlock = \  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null);
  const [boutiqueProfile, setBoutiqueProfile] = useState<{ address?: string }>({});\;
content = content.replace(/  const \[paymentInstructions, setPaymentInstructions\] = useState<PaymentInstructions \| null>\(null\);/, stateBlock);


const newFetch = \  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['paymentInstructions', 'profile']);
    if (error || !data) return;
    
    for (const row of data) {
      if (row.key === 'paymentInstructions') setPaymentInstructions(row.value as unknown as PaymentInstructions);
      if (row.key === 'profile') setBoutiqueProfile(row.value as { address?: string });
    }
  }, []);\;

const oldFetch = \  const fetchPaymentInstructions = useCallback(async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'paymentInstructions')
      .maybeSingle();
    if (error || !data) return;
    setPaymentInstructions(data.value as unknown as PaymentInstructions);
  }, []);\;

content = content.replace(oldFetch, newFetch);

content = content.replace(/fetchPaymentInstructions\(\);/, 'fetchSettings();');
content = content.replace(/fetchPaymentInstructions/g, 'fetchSettings');

const oldLocation = \              <Text style={{ color: colors.secondaryText, fontSize: 15, marginTop: 4, lineHeight: 22 }}>
                123 Fashion Street, Makati City, Philippines
              </Text>\;
const newLocation = \              <Text style={{ color: colors.secondaryText, fontSize: 15, marginTop: 4, lineHeight: 22 }}>
                {boutiqueProfile.address || '123 Fashion Street, Makati City, Philippines'}
              </Text>\;
content = content.replace(oldLocation, newLocation);

fs.writeFileSync('app/reservations/[id].tsx', content);
console.log('done');
