-- Fix REVIEW-001: Customers can forge admin-only fields on their own reviews
-- This trigger ensures that only staff can update privileged fields.

CREATE OR REPLACE FUNCTION public.harden_reviews_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- If the user is staff or admin, allow all changes
  IF public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, force privileged fields back to their old values
  NEW.verified_purchase = OLD.verified_purchase;
  NEW.admin_reply = OLD.admin_reply;
  NEW.is_pinned = OLD.is_pinned;
  NEW.likes = OLD.likes;
  NEW.dislikes = OLD.dislikes;
  NEW.product_id = OLD.product_id;
  NEW.user_id = OLD.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_harden_reviews_update ON public.reviews;
CREATE TRIGGER tr_harden_reviews_update
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.harden_reviews_update_trigger();
