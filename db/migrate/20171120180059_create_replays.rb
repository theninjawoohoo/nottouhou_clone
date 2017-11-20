
class CreateReplays < ActiveRecord::Migration[5.1]
  def change
    create_table :replays do |t|
      t.integer :user_id
      t.string :replay_id

      t.timestamps
    end
  end
end